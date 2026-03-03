/**
 * IPC API routes for the Python selfbot.
 *
 * These endpoints allow the Python selfbot to control all backend
 * operations (Plex, YouTube, streaming, queue, etc.) via HTTP.
 * The Python bot sends commands here; the TS backend executes them.
 */

import { Router, Request, Response } from 'express';
import { getVideoStreamer, getPlaybackPosition, clearPlaybackPosition } from '../stream/video-streamer.js';
import plexClient from '../plex/client.js';
import { parseTimeString, formatDuration, getNextEpisode } from '../plex/library.js';
import { searchMedia, formatSearchResults, getSearchResult } from '../plex/search.js';
import { getQueue, addToQueue, removeFromQueue, clearQueue, popQueue, peekQueue } from '../data/queue.js';
import { getWatchDeck, formatDeckEntry } from '../data/watch-deck.js';
import { downloadYouTubeVideo, findDownloadedVideoByUrl, getYtdlpBaseArgs } from '../youtube/downloader.js';
import { spawn } from 'child_process';
import type { PlexMediaItem, MediaItem } from '../types/index.js';

const router = Router();

// ──────────────────────────────────────────────────────────────
// Playback Controls
// ──────────────────────────────────────────────────────────────

router.post('/pause', async (req: Request, res: Response) => {
  try {
    const { guildId } = req.body;
    const streamer = getVideoStreamer();

    const targetGuild = guildId || streamer.getAllSessions()[0];
    if (!targetGuild) {
      return res.json({ success: false, error: 'No active stream' });
    }

    const session = streamer.getSession(targetGuild);
    if (!session) {
      return res.json({ success: false, error: 'No active stream' });
    }

    if (session.isPaused) {
      await streamer.resumeStream(targetGuild);
      res.json({ success: true, message: 'Playback resumed' });
    } else {
      await streamer.pauseStream(targetGuild);
      res.json({ success: true, message: 'Playback paused' });
    }
  } catch (error) {
    res.json({ success: false, error: 'Pause/resume failed' });
  }
});

router.post('/stop', async (req: Request, res: Response) => {
  try {
    const { guildId } = req.body;
    const streamer = getVideoStreamer();

    const targetGuild = guildId || streamer.getAllSessions()[0];
    if (!targetGuild) {
      return res.json({ success: false, error: 'No active stream' });
    }

    await streamer.stopStream(targetGuild);
    res.json({ success: true, message: 'Stream stopped' });
  } catch (error) {
    res.json({ success: false, error: 'Stop failed' });
  }
});

router.post('/seek', async (req: Request, res: Response) => {
  try {
    const { guildId, timeMs } = req.body;
    const streamer = getVideoStreamer();

    const targetGuild = guildId || streamer.getAllSessions()[0];
    if (!targetGuild) {
      return res.json({ success: false, error: 'No active stream' });
    }

    await streamer.seekStream(targetGuild, timeMs);
    res.json({ success: true, message: `Seeked to ${formatDuration(timeMs)}` });
  } catch (error) {
    res.json({ success: false, error: 'Seek failed' });
  }
});

router.post('/ff', async (req: Request, res: Response) => {
  try {
    const { guildId, offsetMs } = req.body;
    const streamer = getVideoStreamer();

    const targetGuild = guildId || streamer.getAllSessions()[0];
    if (!targetGuild) {
      return res.json({ success: false, error: 'No active stream' });
    }

    const currentTime = streamer.getCurrentTime(targetGuild);
    const session = streamer.getSession(targetGuild);
    const newTime = Math.min(currentTime + offsetMs, session?.duration || Infinity);
    await streamer.seekStream(targetGuild, newTime);
    res.json({ success: true, message: `Fast forwarded`, newTime });
  } catch (error) {
    res.json({ success: false, error: 'Fast forward failed' });
  }
});

router.post('/rw', async (req: Request, res: Response) => {
  try {
    const { guildId, offsetMs } = req.body;
    const streamer = getVideoStreamer();

    const targetGuild = guildId || streamer.getAllSessions()[0];
    if (!targetGuild) {
      return res.json({ success: false, error: 'No active stream' });
    }

    const currentTime = streamer.getCurrentTime(targetGuild);
    const newTime = Math.max(currentTime - offsetMs, 0);
    await streamer.seekStream(targetGuild, newTime);
    res.json({ success: true, message: `Rewound`, newTime });
  } catch (error) {
    res.json({ success: false, error: 'Rewind failed' });
  }
});

router.post('/volume', async (req: Request, res: Response) => {
  try {
    const { guildId, level } = req.body;
    const streamer = getVideoStreamer();

    const targetGuild = guildId || streamer.getAllSessions()[0];
    if (!targetGuild) {
      return res.json({ success: false, error: 'No active stream' });
    }

    await streamer.setVolume(targetGuild, level);
    res.json({ success: true, message: `Volume set to ${level}%` });
  } catch (error) {
    res.json({ success: false, error: 'Volume change failed' });
  }
});

router.post('/speed', async (req: Request, res: Response) => {
  try {
    const { guildId, speed } = req.body;
    const streamer = getVideoStreamer();

    const targetGuild = guildId || streamer.getAllSessions()[0];
    if (!targetGuild) {
      return res.json({ success: false, error: 'No active stream' });
    }

    await streamer.setSpeed(targetGuild, speed);
    res.json({ success: true, message: `Speed set to ${speed}x` });
  } catch (error) {
    res.json({ success: false, error: 'Speed change failed' });
  }
});

router.get('/nowplaying/:guildId', async (req: Request, res: Response) => {
  try {
    const guildId = req.params.guildId as string;
    const streamer = getVideoStreamer();
    const session = streamer.getSession(guildId);

    if (!session) {
      return res.json({ success: false, error: 'Nothing is currently playing' });
    }

    const progress = streamer.getProgress(guildId);
    const speed = streamer.getSpeed(guildId);

    // Build title
    let title = session.mediaItem.title;
    if (session.mediaItem.type === 'episode' && (session.mediaItem as PlexMediaItem).grandparentTitle) {
      const item = session.mediaItem as PlexMediaItem;
      const season = item.parentIndex ? `S${String(item.parentIndex).padStart(2, '0')}` : '';
      const episode = item.index ? `E${String(item.index).padStart(2, '0')}` : '';
      title = `${item.grandparentTitle} ${season}${episode} - ${item.title}`;
    }

    let year: number | string | undefined;
    if (session.mediaItem.type === 'movie' || session.mediaItem.type === 'show' || session.mediaItem.type === 'episode') {
      year = (session.mediaItem as PlexMediaItem).year;
    }

    res.json({
      success: true,
      title,
      isPaused: session.isPaused,
      currentTime: progress.current,
      duration: progress.total,
      percentage: progress.percentage,
      volume: session.volume,
      speed,
      year,
    });
  } catch (error) {
    res.json({ success: false, error: 'Failed to get now playing info' });
  }
});

// ──────────────────────────────────────────────────────────────
// Plex Operations
// ──────────────────────────────────────────────────────────────

router.post('/plex/search', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    const results = await plexClient.search(query);
    res.json({ success: true, results: results.slice(0, 20) });
  } catch (error) {
    res.json({ success: false, error: 'Search failed' });
  }
});

router.post('/plex/play', async (req: Request, res: Response) => {
  try {
    const { guildId, channelId, ratingKey, userId, startTimeMs, seasonNum, episodeNum } = req.body;

    let itemToPlay: PlexMediaItem | null = await plexClient.getMetadata(ratingKey);
    if (!itemToPlay) {
      return res.json({ success: false, error: 'Media not found' });
    }

    // Handle TV show episode selection
    if (itemToPlay.type === 'show') {
      const episodes = await plexClient.getEpisodes(ratingKey);
      if (episodes.length === 0) {
        return res.json({ success: false, error: 'No episodes found' });
      }

      if (seasonNum && episodeNum) {
        const found = episodes.find(ep => ep.parentIndex === seasonNum && ep.index === episodeNum);
        if (found) {
          itemToPlay = found;
        } else {
          return res.json({ success: false, error: `Episode S${String(seasonNum).padStart(2, '0')}E${String(episodeNum).padStart(2, '0')} not found` });
        }
      } else {
        // Default to first episode
        itemToPlay = episodes[0];
      }
    }

    // Check for saved position
    const savedPosition = getPlaybackPosition(itemToPlay.ratingKey);
    const effectiveStart = startTimeMs || (savedPosition && savedPosition > 60000 ? savedPosition : 0);

    const streamInfo = await plexClient.getDirectStreamUrl(itemToPlay.ratingKey);
    if (!streamInfo) {
      return res.json({ success: false, error: 'Could not get stream URL' });
    }

    const streamer = getVideoStreamer();
    await streamer.startStream(guildId, channelId, itemToPlay, streamInfo.url, effectiveStart, userId);

    // Build response title
    let title = itemToPlay.title;
    if (itemToPlay.type === 'episode' && itemToPlay.grandparentTitle) {
      const s = itemToPlay.parentIndex ? `S${String(itemToPlay.parentIndex).padStart(2, '0')}` : '';
      const e = itemToPlay.index ? `E${String(itemToPlay.index).padStart(2, '0')}` : '';
      title = `${itemToPlay.grandparentTitle} ${s}${e} - ${itemToPlay.title}`;
    }

    res.json({
      success: true,
      title,
      duration: itemToPlay.duration,
      ratingKey: itemToPlay.ratingKey,
    });
  } catch (error) {
    console.error('[IPC] Plex play error:', error);
    res.json({ success: false, error: 'Failed to start stream' });
  }
});

router.post('/plex/play-resume', async (req: Request, res: Response) => {
  try {
    const { guildId, channelId, userId, action } = req.body;
    // Resume functionality is handled within the play endpoint via saved positions
    res.json({ success: true, message: action === 'resume' ? '▶️ Resuming...' : '🎬 Starting from beginning...' });
  } catch (error) {
    res.json({ success: false, error: 'Resume failed' });
  }
});

router.get('/plex/episodes/:ratingKey', async (req: Request, res: Response) => {
  try {
    const ratingKey = req.params.ratingKey as string;
    const episodes = await plexClient.getEpisodes(ratingKey);
    res.json({ success: true, episodes });
  } catch (error) {
    res.json({ success: false, error: 'Failed to get episodes' });
  }
});

router.get('/plex/seasons/:ratingKey', async (req: Request, res: Response) => {
  try {
    const ratingKey = req.params.ratingKey as string;
    const seasons = await plexClient.getSeasons(ratingKey);
    res.json({ success: true, seasons });
  } catch (error) {
    res.json({ success: false, error: 'Failed to get seasons' });
  }
});

router.post('/plex/skip', async (req: Request, res: Response) => {
  try {
    const { guildId } = req.body;
    const streamer = getVideoStreamer();
    const session = streamer.getSession(guildId);

    if (!session) {
      return res.json({ success: false, error: 'No active stream' });
    }

    if (session.mediaItem.type !== 'episode') {
      return res.json({ success: false, error: 'Skip is only available for TV shows' });
    }

    const nextEpisode = await getNextEpisode(session.mediaItem);
    if (!nextEpisode) {
      return res.json({ success: false, error: 'No next episode available (end of series or season)' });
    }

    const streamInfo = await plexClient.getDirectStreamUrl(nextEpisode.ratingKey);
    if (!streamInfo) {
      return res.json({ success: false, error: 'Could not get stream URL for next episode' });
    }

    await streamer.startStream(guildId, session.channelId, nextEpisode, streamInfo.url, 0);

    const season = nextEpisode.parentIndex ? `S${String(nextEpisode.parentIndex).padStart(2, '0')}` : '';
    const episode = nextEpisode.index ? `E${String(nextEpisode.index).padStart(2, '0')}` : '';
    const title = `${nextEpisode.grandparentTitle || ''} ${season}${episode} - ${nextEpisode.title}`;
    const duration = nextEpisode.duration ? formatDuration(nextEpisode.duration) : 'Unknown';

    res.json({ success: true, title, duration });
  } catch (error) {
    res.json({ success: false, error: 'Skip failed' });
  }
});

router.post('/plex/random', async (req: Request, res: Response) => {
  try {
    const { guildId, channelId, userId, type } = req.body;

    const libraries = await plexClient.getLibraries();
    let targetLibraries = libraries;

    if (type === 'movie') {
      targetLibraries = libraries.filter(lib => lib.type === 'movie');
    } else if (type === 'show') {
      targetLibraries = libraries.filter(lib => lib.type === 'show');
    }

    if (targetLibraries.length === 0) {
      return res.json({ success: false, error: `No ${type} libraries found` });
    }

    const randomLibrary = targetLibraries[Math.floor(Math.random() * targetLibraries.length)];
    const items = await plexClient.getLibraryItems(randomLibrary.key);

    if (items.length === 0) {
      return res.json({ success: false, error: 'No items found in library' });
    }

    let randomItem = items[Math.floor(Math.random() * items.length)];
    let itemToPlay: PlexMediaItem = randomItem;

    if (randomItem.type === 'show') {
      const episodes = await plexClient.getEpisodes(randomItem.ratingKey);
      if (episodes.length === 0) {
        return res.json({ success: false, error: `No episodes found for ${randomItem.title}` });
      }
      itemToPlay = episodes[Math.floor(Math.random() * episodes.length)];
    }

    const streamInfo = await plexClient.getDirectStreamUrl(itemToPlay.ratingKey);
    if (!streamInfo) {
      return res.json({ success: false, error: 'Could not get stream URL' });
    }

    let title = itemToPlay.title;
    if (itemToPlay.type === 'episode' && itemToPlay.grandparentTitle) {
      const s = itemToPlay.parentIndex ? `S${String(itemToPlay.parentIndex).padStart(2, '0')}` : '';
      const e = itemToPlay.index ? `E${String(itemToPlay.index).padStart(2, '0')}` : '';
      title = `${itemToPlay.grandparentTitle} ${s}${e} - ${itemToPlay.title}`;
    }

    const streamer = getVideoStreamer();
    await streamer.startStream(guildId, channelId, itemToPlay, streamInfo.url, 0, userId);

    res.json({ success: true, title, duration: itemToPlay.duration });
  } catch (error) {
    console.error('[IPC] Random play error:', error);
    res.json({ success: false, error: 'Failed to play random media' });
  }
});

router.get('/plex/ondeck', async (_req: Request, res: Response) => {
  try {
    const deck = getWatchDeck();
    res.json({ success: true, deck });
  } catch (error) {
    res.json({ success: false, error: 'Failed to get watch deck' });
  }
});

router.post('/plex/ondeck/play', async (req: Request, res: Response) => {
  try {
    const { guildId, channelId, ratingKey, userId } = req.body;

    const mediaItem = await plexClient.getMetadata(ratingKey);
    if (!mediaItem) {
      return res.json({ success: false, error: 'Could not find this item in Plex anymore' });
    }

    const streamInfo = await plexClient.getDirectStreamUrl(ratingKey);
    if (!streamInfo) {
      return res.json({ success: false, error: 'Could not get stream URL' });
    }

    const savedPosition = getPlaybackPosition(ratingKey);
    const startPosition = savedPosition && savedPosition > 30000 ? savedPosition : 0;

    let title = mediaItem.title;
    if (mediaItem.type === 'episode' && mediaItem.grandparentTitle) {
      const s = mediaItem.parentIndex ? `S${String(mediaItem.parentIndex).padStart(2, '0')}` : '';
      const e = mediaItem.index ? `E${String(mediaItem.index).padStart(2, '0')}` : '';
      title = `${mediaItem.grandparentTitle} ${s}${e} - ${mediaItem.title}`;
    }

    const streamer = getVideoStreamer();
    await streamer.startStream(guildId, channelId, mediaItem, streamInfo.url, startPosition, userId);

    res.json({ success: true, title, duration: mediaItem.duration });
  } catch (error) {
    res.json({ success: false, error: 'Failed to resume from on deck' });
  }
});

router.get('/playback-position/:ratingKey', async (req: Request, res: Response) => {
  try {
    const ratingKey = req.params.ratingKey as string;
    const position = getPlaybackPosition(ratingKey);
    res.json({ success: true, position: position || 0 });
  } catch (error) {
    res.json({ success: false, error: 'Failed to get playback position' });
  }
});

// ──────────────────────────────────────────────────────────────
// YouTube Operations
// ──────────────────────────────────────────────────────────────

router.post('/youtube/play', async (req: Request, res: Response) => {
  try {
    const { guildId, channelId, url, userId, startTimeMs } = req.body;

    // Check for existing download
    const existingVideo = findDownloadedVideoByUrl(url);
    if (existingVideo) {
      const streamer = getVideoStreamer();
      const mediaItem = {
        ratingKey: `yt-${Date.now()}`,
        key: url,
        title: existingVideo.title,
        type: 'movie' as const,
        duration: existingVideo.duration,
        thumb: existingVideo.thumbnail,
        summary: existingVideo.uploader ? `By ${existingVideo.uploader}` : undefined,
      };

      await streamer.startLocalFile(guildId, channelId, mediaItem, existingVideo.filePath, userId, startTimeMs || 0);

      return res.json({
        success: true,
        title: existingVideo.title,
        duration: existingVideo.duration,
        uploader: existingVideo.uploader,
      });
    }

    // Download the video
    const downloadedVideo = await downloadYouTubeVideo(url, {});
    if (!downloadedVideo) {
      return res.json({ success: false, error: 'Failed to download video' });
    }

    const streamer = getVideoStreamer();
    const mediaItem = {
      ratingKey: `yt-${Date.now()}`,
      key: url,
      title: downloadedVideo.title,
      type: 'movie' as const,
      duration: downloadedVideo.duration,
      thumb: downloadedVideo.thumbnail,
      summary: downloadedVideo.uploader ? `By ${downloadedVideo.uploader}` : undefined,
    };

    await streamer.startLocalFile(guildId, channelId, mediaItem, downloadedVideo.filePath, userId, startTimeMs || 0);

    res.json({
      success: true,
      title: downloadedVideo.title,
      duration: downloadedVideo.duration,
      uploader: downloadedVideo.uploader,
    });
  } catch (error) {
    console.error('[IPC] YouTube play error:', error);
    res.json({ success: false, error: 'YouTube playback failed' });
  }
});

router.post('/youtube/search', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    const baseArgs = getYtdlpBaseArgs();
    const ytdlp = spawn('yt-dlp', [
      ...baseArgs,
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      '-I', '1:20',
      `ytsearch20:${query}`,
    ]);

    let output = '';
    ytdlp.stdout.on('data', (data) => { output += data.toString(); });

    const results = await new Promise<any[]>((resolve) => {
      ytdlp.on('close', () => {
        try {
          const lines = output.trim().split('\n');
          const parsed = lines.map(line => {
            try {
              const data = JSON.parse(line);
              return {
                id: data.id,
                title: data.title,
                duration: data.duration ? `${Math.floor(data.duration / 60)}:${String(Math.floor(data.duration % 60)).padStart(2, '0')}` : 'N/A',
                channel: data.channel || data.uploader || 'Unknown',
                url: data.url || `https://youtube.com/watch?v=${data.id}`,
                views: data.view_count ? `${(data.view_count / 1_000_000).toFixed(1)}M views` : '',
              };
            } catch {
              return null;
            }
          }).filter(Boolean);
          resolve(parsed);
        } catch {
          resolve([]);
        }
      });
    });

    res.json({ success: true, results });
  } catch (error) {
    res.json({ success: false, error: 'YouTube search failed' });
  }
});

router.get('/youtube/trending', async (req: Request, res: Response) => {
  try {
    const category = (req.query.category as string) || 'default';

    const categoryUrls: Record<string, string> = {
      default: 'https://www.youtube.com/feed/trending',
      music: 'https://www.youtube.com/feed/trending?bp=4gINGgt5dG1hX2NoYXJ0cw',
      gaming: 'https://www.youtube.com/feed/trending?bp=4gIcGhpnYW1pbmdfY29ycHVzX21vc3RfcG9wdWxhcg',
      news: 'https://www.youtube.com/feed/trending?bp=4gINGgt5dG1hX25ld3Nfcw',
      movies: 'https://www.youtube.com/feed/trending?bp=4gIKGgh0cmFpbGVycw',
    };

    const trendingUrl = categoryUrls[category] || categoryUrls.default;

    const baseArgs = getYtdlpBaseArgs();
    const ytdlp = spawn('yt-dlp', [
      ...baseArgs,
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      '-I', '1:20',
      trendingUrl,
    ]);

    let output = '';
    ytdlp.stdout.on('data', (data) => { output += data.toString(); });

    const results = await new Promise<any[]>((resolve) => {
      ytdlp.on('close', () => {
        try {
          const lines = output.trim().split('\n');
          const parsed = lines.map(line => {
            try {
              const data = JSON.parse(line);
              return {
                id: data.id,
                title: data.title,
                duration: data.duration ? `${Math.floor(data.duration / 60)}:${String(Math.floor(data.duration % 60)).padStart(2, '0')}` : 'N/A',
                channel: data.channel || data.uploader || 'Unknown',
                url: data.url || `https://youtube.com/watch?v=${data.id}`,
                views: data.view_count ? `${(data.view_count / 1_000_000).toFixed(1)}M views` : '',
              };
            } catch {
              return null;
            }
          }).filter(Boolean);
          resolve(parsed);
        } catch {
          resolve([]);
        }
      });
    });

    res.json({ success: true, results });
  } catch (error) {
    res.json({ success: false, error: 'Trending fetch failed' });
  }
});

router.post('/youtube/music', async (req: Request, res: Response) => {
  try {
    const { guildId, channelId, url, userId, action, query, startTimeMs } = req.body;

    // Handle action subcommands
    if (action) {
      const { getMusicQueue, clearMusicQueue, isAutoplayEnabled, setAutoplay } = await import('../data/music-queue.js');

      switch (action) {
        case 'queue': {
          const queueState = getMusicQueue(guildId);
          if (queueState.tracks.length === 0) {
            return res.json({ success: true, message: '🎵 Music queue is empty' });
          }
          const lines = queueState.tracks.map((t: any, i: number) => `**${i + 1}.** ${t.title} — ${t.artist}`).join('\n');
          return res.json({ success: true, message: `🎵 **Music Queue** (${queueState.tracks.length} tracks)\n\n${lines}` });
        }
        case 'stop':
          clearMusicQueue(guildId);
          await getVideoStreamer().stopStream(guildId);
          return res.json({ success: true, message: '⏹️ Music stopped and queue cleared' });
        case 'autoplay':
          setAutoplay(guildId, true);
          return res.json({ success: true, message: '🔄 Autoplay enabled — recommendations will auto-queue' });
        case 'autoplay-off':
          setAutoplay(guildId, false);
          return res.json({ success: true, message: '⏹️ Autoplay disabled' });
        case 'mix': {
          // Start a mix from a query or default
          const searchQuery = query || 'music mix';
          const baseArgs = getYtdlpBaseArgs();
          const ytdlp = spawn('yt-dlp', [
            ...baseArgs, '--dump-json', '--flat-playlist', '--no-warnings', '-I', '1:20',
            `ytsearch5:${searchQuery} mix`,
          ]);
          let output = '';
          ytdlp.stdout.on('data', (data) => { output += data.toString(); });

          const mixResults = await new Promise<any[]>((resolve) => {
            ytdlp.on('close', () => {
              try {
                resolve(output.trim().split('\n').map(l => JSON.parse(l)).filter(Boolean));
              } catch {
                resolve([]);
              }
            });
          });

          if (mixResults.length === 0) {
            return res.json({ success: false, error: 'No mix results found' });
          }

          // Queue them all via the music downloader
          const { downloadYouTubeMusic } = await import('../youtube/music-downloader.js');
          const { addToMusicQueue } = await import('../data/music-queue.js');

          const tracks = mixResults.map(r => ({
            id: r.id || `mix-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            title: r.title || 'Unknown',
            artist: r.channel || r.uploader || 'Unknown',
            url: r.url || `https://youtube.com/watch?v=${r.id}`,
            duration: (r.duration || 0) * 1000,
          }));

          addToMusicQueue(guildId, tracks.slice(1));

          // Download and play first track
          const firstTrack = tracks[0];
          const downloaded = await downloadYouTubeMusic(firstTrack.url);
          if (!downloaded) {
            return res.json({ success: false, error: 'Failed to download first track' });
          }

          const streamer = getVideoStreamer();
          await streamer.startMusicStream(
            guildId, channelId,
            {
              ratingKey: `ytm-${Date.now()}`,
              key: firstTrack.url,
              type: 'music',
              title: downloaded.title || firstTrack.title,
              artist: downloaded.artist || firstTrack.artist,
              duration: downloaded.duration || firstTrack.duration,
              url: firstTrack.url,
              audioPath: downloaded.audioPath,
              thumbnailPath: downloaded.thumbnailPath,
            },
            downloaded.audioPath,
            downloaded.thumbnailPath,
            downloaded.artist || firstTrack.artist,
            userId,
          );

          return res.json({
            success: true,
            message: `🎵 **Mix Started:** ${firstTrack.title}\n👤 ${firstTrack.artist}\n📋 ${tracks.length - 1} more tracks queued`,
          });
        }
      }
    }

    // Direct URL play
    if (!url) {
      return res.json({ success: false, error: 'No URL provided' });
    }

    const { downloadYouTubeMusic, findDownloadedMusicByUrl } = await import('../youtube/music-downloader.js');

    let downloaded = findDownloadedMusicByUrl(url);
    if (!downloaded) {
      downloaded = await downloadYouTubeMusic(url);
    }

    if (!downloaded) {
      return res.json({ success: false, error: 'Failed to download audio' });
    }

    const streamer = getVideoStreamer();
    await streamer.startMusicStream(
      guildId, channelId,
      {
        ratingKey: `ytm-${Date.now()}`,
        key: url,
        type: 'music',
        title: downloaded.title || 'Unknown Track',
        artist: downloaded.artist || 'Unknown Artist',
        duration: downloaded.duration || 0,
        url,
        audioPath: downloaded.audioPath,
        thumbnailPath: downloaded.thumbnailPath,
      },
      downloaded.audioPath,
      downloaded.thumbnailPath,
      downloaded.artist || 'Unknown Artist',
      userId,
    );

    res.json({
      success: true,
      message: `🎵 **Now Playing:** ${downloaded.title}\n👤 ${downloaded.artist}`,
    });
  } catch (error) {
    console.error('[IPC] YouTube music error:', error);
    res.json({ success: false, error: 'Music playback failed' });
  }
});

// ──────────────────────────────────────────────────────────────
// External URL
// ──────────────────────────────────────────────────────────────

router.post('/url/play', async (req: Request, res: Response) => {
  try {
    const { guildId, channelId, url, title, userId } = req.body;

    const mediaItem = {
      ratingKey: `url-${Date.now()}`,
      key: url,
      title: title || 'External Stream',
      type: 'movie' as const,
      duration: 0,
    };

    const streamer = getVideoStreamer();
    await streamer.startExternalStream(guildId, channelId, mediaItem, url, userId);

    // Determine stream type
    const lower = url.toLowerCase();
    let streamType = 'Unknown';
    if (lower.includes('.m3u8') || lower.includes('.m3u')) streamType = 'HLS';
    else if (lower.includes('.mp4')) streamType = 'MP4';
    else if (lower.includes('.webm')) streamType = 'WebM';
    else if (lower.includes('.mkv')) streamType = 'MKV';
    else if (lower.includes('rtmp://')) streamType = 'RTMP';

    res.json({ success: true, streamType });
  } catch (error) {
    res.json({ success: false, error: 'URL playback failed' });
  }
});

// ──────────────────────────────────────────────────────────────
// Queue
// ──────────────────────────────────────────────────────────────

router.get('/queue/:guildId', async (req: Request, res: Response) => {
  try {
    const items = getQueue();
    res.json({ success: true, items });
  } catch (error) {
    res.json({ success: false, error: 'Failed to get queue' });
  }
});

router.post('/queue/:guildId/add', async (req: Request, res: Response) => {
  try {
    addToQueue(req.body);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: 'Failed to add to queue' });
  }
});

router.post('/queue/:guildId/remove', async (req: Request, res: Response) => {
  try {
    const { index } = req.body;
    removeFromQueue(index - 1);
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: 'Failed to remove from queue' });
  }
});

router.post('/queue/:guildId/clear', async (req: Request, res: Response) => {
  try {
    clearQueue();
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, error: 'Failed to clear queue' });
  }
});

router.post('/queue/:guildId/start', async (req: Request, res: Response) => {
  try {
    const guildId = req.params.guildId as string;
    const { channelId, userId } = req.body;
    const item = popQueue();
    if (!item) {
      return res.json({ success: false, error: 'Queue is empty' });
    }

    // Queue entries store ratingKey — fetch metadata and stream
    const mediaItem = await plexClient.getMetadata(item.ratingKey);
    if (!mediaItem) {
      return res.json({ success: false, error: 'Media not found' });
    }

    const streamInfo = await plexClient.getDirectStreamUrl(item.ratingKey);
    if (!streamInfo) {
      return res.json({ success: false, error: 'Could not get stream URL' });
    }

    const streamer = getVideoStreamer();
    await streamer.startStream(guildId, channelId, mediaItem, streamInfo.url, 0, userId);

    res.json({ success: true, message: `Playing: ${item.title}` });
  } catch (error) {
    res.json({ success: false, error: 'Failed to start queue' });
  }
});

router.post('/queue/:guildId/next', async (req: Request, res: Response) => {
  try {
    const guildId = req.params.guildId as string;
    const { channelId, userId } = req.body;
    const item = popQueue();
    if (!item) {
      return res.json({ success: false, error: 'No more items in queue' });
    }

    const mediaItem = await plexClient.getMetadata(item.ratingKey);
    if (!mediaItem) {
      return res.json({ success: false, error: 'Media not found' });
    }

    const streamInfo = await plexClient.getDirectStreamUrl(item.ratingKey);
    if (!streamInfo) {
      return res.json({ success: false, error: 'Could not get stream URL' });
    }

    const streamer = getVideoStreamer();
    await streamer.startStream(guildId, channelId, mediaItem, streamInfo.url, 0, userId);

    res.json({ success: true, message: `Playing next: ${item.title}` });
  } catch (error) {
    res.json({ success: false, error: 'Failed to play next in queue' });
  }
});

// ──────────────────────────────────────────────────────────────
// Activity (for Python bot to request status changes)
// ──────────────────────────────────────────────────────────────

router.post('/activity', async (req: Request, res: Response) => {
  // Activity is now managed by the Python selfbot directly
  res.json({ success: true });
});

export default router;
