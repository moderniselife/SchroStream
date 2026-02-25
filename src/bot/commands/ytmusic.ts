import type { Message, VoiceChannel } from 'discord.js-selfbot-v13';
import { getVideoStreamer } from '../../stream/video-streamer.js';
import { formatDuration, parseTimeString } from '../../plex/library.js';
import {
  downloadYouTubeMusic,
  findDownloadedMusicByUrl,
  getPlaylistTracks,
  getMusicRecommendations,
  isPlaylistUrl,
  type MusicDownloadProgress,
  type MusicTrackInfo,
} from '../../youtube/music-downloader.js';
import {
  seedMusicQueue,
  clearMusicQueue,
  setAutoplay,
  isAutoplayEnabled,
  getMusicQueueLength,
  addToMusicQueue,
} from '../../data/music-queue.js';
import type { MusicMediaItem } from '../../types/index.js';
import { getYtdlpBaseArgs } from '../../youtube/downloader.js';
import { spawn } from 'child_process';

// Pick a seed track for a mix by searching YouTube Music for a popular track
async function getMixSeedTrack(query = 'trending music'): Promise<MusicTrackInfo | null> {
  return new Promise((resolve) => {
    const baseArgs = getYtdlpBaseArgs();
    const ytdlp = spawn('yt-dlp', [
      ...baseArgs,
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      '-I', '1:1',
      `ytsearch1:${query}`,
    ]);

    let output = '';
    ytdlp.stdout.on('data', (d) => { output += d.toString(); });
    ytdlp.on('close', (code) => {
      if (code !== 0 || !output.trim()) { resolve(null); return; }
      try {
        const info = JSON.parse(output.trim().split('\n')[0]);
        resolve({
          id: info.id,
          title: info.title || info.id,
          artist: info.channel || info.uploader || info.uploader_id || 'Unknown Artist',
          duration: info.duration || 0,
          url: info.url || info.webpage_url || `https://www.youtube.com/watch?v=${info.id}`,
          thumbnailUrl: info.thumbnail || `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`,
        });
      } catch { resolve(null); }
    });
    ytdlp.on('error', () => resolve(null));
  });
}

function createProgressBar(percent: number): string {
  const barLength = 20;
  const filledLength = Math.round((percent / 100) * barLength);
  const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
  return `[${bar}] ${percent.toFixed(1)}%`;
}

async function downloadAndPlay(
  url: string,
  guildId: string,
  channelId: string,
  userId: string,
  statusMsg: Message,
  startTimeMs = 0,
): Promise<void> {
  const videoStreamer = getVideoStreamer();

  // Check cache first
  const existingMusic = findDownloadedMusicByUrl(url);
  if (existingMusic) {
    console.log(`[YTMusic] Playing from cache: ${url}`);
    const mediaItem: MusicMediaItem = {
      ratingKey: `music-${Date.now()}`,
      key: url,
      title: existingMusic.title,
      artist: existingMusic.artist,
      type: 'music',
      duration: existingMusic.duration,
      thumb: existingMusic.thumbnailUrl,
      url,
      audioPath: existingMusic.audioPath,
      thumbnailPath: existingMusic.thumbnailPath,
    };
    await statusMsg.edit(
      `🎵 **Now Playing:** ${existingMusic.title}\n` +
      `🎤 ${existingMusic.artist}\n` +
      `⏱️ ${existingMusic.duration ? formatDuration(existingMusic.duration) : 'Unknown'}\n` +
      `📥 From cache — starting instantly...`,
    );
    await videoStreamer.startMusicStream(guildId, channelId, mediaItem, existingMusic.audioPath, existingMusic.thumbnailPath, existingMusic.artist, userId, startTimeMs);
    await new Promise(r => setTimeout(r, 1500));
    await statusMsg.edit(`🎵 **Now Playing:** ${existingMusic.title}\n🎤 ${existingMusic.artist}\n🎶 Enjoy the music!`);
    return;
  }

  // Download
  const downloaded = await downloadYouTubeMusic(url, {
    onProgress: async (progress: MusicDownloadProgress) => {
      const bar = createProgressBar(progress.percent);
      try {
        await statusMsg.edit(
          `🎵 **Downloading Audio**\n${bar}\n📊 ${progress.speed} | ⏱️ ETA: ${progress.eta}\n\n*Will start playing when complete...*`,
        );
      } catch { /* ignore rate limit errors */ }
    },
    onComplete: async () => {
      try {
        await statusMsg.edit(`🎵 **Download Complete!**\n✅ Starting music visualizer...`);
      } catch { /* ignore */ }
    },
    onError: async (error: string) => {
      try { await statusMsg.edit(`❌ Download failed: ${error}`); } catch { /* ignore */ }
    },
  });

  if (!downloaded) return;

  const mediaItem: MusicMediaItem = {
    ratingKey: `music-${Date.now()}`,
    key: url,
    title: downloaded.title,
    artist: downloaded.artist,
    type: 'music',
    duration: downloaded.duration,
    thumb: downloaded.thumbnailUrl,
    url,
    audioPath: downloaded.audioPath,
    thumbnailPath: downloaded.thumbnailPath,
  };

  await statusMsg.edit(
    `🎵 **Starting:** ${downloaded.title}\n` +
    `🎤 ${downloaded.artist}\n` +
    `⏱️ ${downloaded.duration ? formatDuration(downloaded.duration) : 'Unknown'}\n\n` +
    `*Connecting to voice channel...*`,
  );

  await videoStreamer.startMusicStream(guildId, channelId, mediaItem, downloaded.audioPath, downloaded.thumbnailPath, downloaded.artist, userId, startTimeMs);

  await new Promise(r => setTimeout(r, 1500));
  await statusMsg.edit(`🎵 **Now Playing:** ${downloaded.title}\n🎤 ${downloaded.artist}\n🎶 Enjoy the music!`);
}

export async function ytMusicCommand(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.channel.send('❌ This command can only be used in a server');
    return;
  }

  const guildId = message.guild.id;

  // Handle subcommands: autoplay toggle
  if (args[0] === 'autoplay') {
    if (args[1] === 'off') {
      setAutoplay(guildId, false);
      await message.channel.send('🔁 Autoplay **disabled**. Music will stop after the queue is empty.');
    } else {
      setAutoplay(guildId, true);
      await message.channel.send('🔁 Autoplay **enabled**. Recommendations will play when the queue is empty.');
    }
    return;
  }

  // !ytm mix [query] — pick a seed track and play its YouTube auto-mix
  if (args[0] === 'mix') {
    const member = message.guild.members.cache.get(message.author.id);
    const voiceChannel = member?.voice.channel as VoiceChannel | undefined;
    if (!voiceChannel) {
      await message.channel.send('❌ You must be in a voice channel to use this command');
      return;
    }

    const query = args.slice(1).join(' ') || 'popular music';
    const statusMsg = await message.channel.send(`🎵 Finding a mix for: **${query}**...`);

    try {
      const seedTrack = await getMixSeedTrack(query);
      if (!seedTrack) {
        await statusMsg.edit('❌ Could not find a seed track. Try a different query.');
        return;
      }

      await statusMsg.edit(`🎵 Found seed: **${seedTrack.title}** — fetching mix...`);

      const recommendations = await getMusicRecommendations(seedTrack.id, 10);
      if (recommendations.length === 0) {
        await statusMsg.edit('❌ Could not fetch mix recommendations. Try a direct playlist URL instead.');
        return;
      }

      clearMusicQueue(guildId);
      // Queue all but the first recommendation (first will be played immediately)
      if (recommendations.length > 1) {
        addToMusicQueue(guildId, recommendations.slice(1));
      }

      await statusMsg.edit(
        `🎵 **Mix loaded:** ${recommendations.length} tracks\n` +
        `▶️ Starting with: **${recommendations[0].title}**\n\n` +
        `*Downloading first track...*`,
      );

      await downloadAndPlay(recommendations[0].url, guildId, voiceChannel.id, message.author.id, statusMsg, 0);

      await message.channel.send(
        `📋 **${recommendations.length - 1} more track${recommendations.length - 1 !== 1 ? 's' : ''}** queued.\n` +
        `Autoplay is **${isAutoplayEnabled(guildId) ? 'on' : 'off'}** — use \`!ytm autoplay off\` to disable.`,
      );
    } catch (error) {
      console.error('[YTMusic] Mix error:', error);
      await statusMsg.edit(`❌ Failed to load mix: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
    return;
  }

  if (args[0] === 'stop' || args[0] === 'clear') {
    clearMusicQueue(guildId);
    const videoStreamer = getVideoStreamer();
    await videoStreamer.stopStream(guildId);
    await message.channel.send('⏹️ Music stopped and queue cleared.');
    return;
  }

  if (args[0] === 'queue' || args[0] === 'q') {
    const len = getMusicQueueLength(guildId);
    const autoplay = isAutoplayEnabled(guildId);
    await message.channel.send(
      `🎵 **Music Queue:** ${len} track${len !== 1 ? 's' : ''} queued\n` +
      `🔁 Autoplay: **${autoplay ? 'on' : 'off'}**`,
    );
    return;
  }

  const url = args[0];
  if (!url) {
    await message.channel.send(
      '❌ Usage: `!ytm <url> [time]`\n' +
      'Supports: single tracks, playlists (`list=`), albums, and mixes\n' +
      'Subcommands:\n' +
      '• `!ytm mix [query]` — play a YouTube auto-mix (no URL needed!)\n' +
      '• `!ytm autoplay [off]` — toggle autoplay recommendations\n' +
      '• `!ytm queue` — show queue status\n' +
      '• `!ytm stop` — stop music and clear queue\n' +
      'Autoplay is **on** by default — recommendations play after the queue empties.',
    );
    return;
  }

  // Parse optional time argument (only meaningful for single tracks)
  let startTimeMs = 0;
  if (args[1] && !isPlaylistUrl(url)) {
    const parsed = parseTimeString(args[1]);
    if (parsed !== null) startTimeMs = parsed;
  }

  const member = message.guild.members.cache.get(message.author.id);
  const voiceChannel = member?.voice.channel as VoiceChannel | undefined;

  if (!voiceChannel) {
    await message.channel.send('❌ You must be in a voice channel to use this command');
    return;
  }

  // --- Playlist / Album handling ---
  if (isPlaylistUrl(url)) {
    const statusMsg = await message.channel.send('🎵 Fetching playlist tracks...');

    try {
      const tracks = await getPlaylistTracks(url);

      if (tracks.length === 0) {
        await statusMsg.edit('❌ Could not fetch any tracks from that playlist/album. Try a direct video URL instead.');
        return;
      }

      // Seed remaining tracks (after the first) into the music queue
      clearMusicQueue(guildId);
      if (tracks.length > 1) {
        seedMusicQueue(guildId, tracks.slice(1));
      }

      await statusMsg.edit(
        `🎵 **Playlist loaded:** ${tracks.length} tracks\n` +
        `▶️ Starting with: **${tracks[0].title}**\n\n` +
        `*Downloading first track...*`,
      );

      await downloadAndPlay(tracks[0].url, guildId, voiceChannel.id, message.author.id, statusMsg, 0);

      await message.channel.send(
        `📋 **${tracks.length - 1} more track${tracks.length - 1 !== 1 ? 's' : ''}** queued after this one.\n` +
        `Use \`!ytm queue\` to check the queue | \`!ytm autoplay off\` to disable autoplay.`,
      );
    } catch (error) {
      console.error('[YTMusic] Playlist error:', error);
      await statusMsg.edit(`❌ Failed to load playlist: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    return;
  }

  // --- Single track handling ---
  const statusMsg = await message.channel.send('� Fetching music info...');

  try {
    // Clear any existing music queue when playing a new single track (fresh start)
    clearMusicQueue(guildId);
    await downloadAndPlay(url, guildId, voiceChannel.id, message.author.id, statusMsg, startTimeMs);
  } catch (error) {
    console.error('[YTMusic] Error:', error);
    await statusMsg.edit(`❌ Failed to play: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
