import express, { Request, Response } from 'express';
import cors from 'cors';
import { join } from 'path';
import { getVideoStreamer } from '../stream/video-streamer.js';
import type { VideoStreamSession } from '../stream/video-streamer.js';
import plexClient from '../plex/client.js';
import { parseTimeString } from '../plex/library.js';
import { client as selfbotClient } from '../bot/client.js';
import config from '../config.js';
import { spawn } from 'child_process';

const app = express();
const PORT = process.env.WEB_PORT || 3105;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(join(process.cwd(), 'public')));

// Store active stream sessions for web viewing
const webStreamSessions = new Map<string, {
  session: VideoStreamSession;
  streamUrl: string;
  startedAt: number;
}>();

// API Routes

// Get all active streams
app.get('/api/streams', (req: Request, res: Response) => {
  const streamer = getVideoStreamer();
  const guildIds = streamer.getAllSessions();
  
  const streams = guildIds.map(guildId => {
    const session = streamer.getSession(guildId);
    if (!session) return null;
    
    const progress = streamer.getProgress(guildId);
    
    return {
      guildId,
      title: session.mediaItem.title,
      type: session.isExternal ? 'external' : 'plex',
      duration: session.duration,
      currentTime: progress.current,
      percentage: progress.percentage,
      isPaused: session.isPaused,
      volume: session.volume,
      thumbnail: session.mediaItem.thumb,
    };
  }).filter(Boolean);
  
  res.json({ streams });
});

// Get specific stream details
app.get('/api/stream/:guildId', (req: Request, res: Response) => {
  const { guildId } = req.params;
  const streamer = getVideoStreamer();
  const session = streamer.getSession(guildId);
  
  if (!session) {
    return res.status(404).json({ error: 'Stream not found' });
  }
  
  const progress = streamer.getProgress(guildId);
  const webSession = webStreamSessions.get(guildId);
  
  res.json({
    guildId,
    title: session.mediaItem.title,
    description: session.mediaItem.summary,
    type: session.isExternal ? 'external' : 'plex',
    streamUrl: webSession?.streamUrl || session.streamUrl,
    duration: session.duration,
    currentTime: progress.current,
    percentage: progress.percentage,
    isPaused: session.isPaused,
    volume: session.volume,
    thumbnail: session.mediaItem.thumb,
    year: session.mediaItem.year,
  });
});

// Get stream URL for web player
app.get('/api/stream/:guildId/url', (req: Request, res: Response) => {
  const { guildId } = req.params;
  const streamer = getVideoStreamer();
  const session = streamer.getSession(guildId);
  
  if (!session) {
    return res.status(404).json({ error: 'Stream not found' });
  }
  
  // For external streams, return the URL directly
  if (session.isExternal) {
    res.json({ 
      url: session.streamUrl,
      audioUrl: session.audioUrl,
      type: 'external'
    });
  } else {
    // For Plex streams, return the stream URL
    res.json({ 
      url: session.streamUrl,
      type: 'plex'
    });
  }
});

// Control API endpoints
app.post('/api/control/search', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    const results = await plexClient.search(query);
    res.json({ success: true, results: results.slice(0, 20) });
  } catch (error) {
    res.json({ success: false, error: 'Search failed' });
  }
});

app.post('/api/control/play', async (req: Request, res: Response) => {
  try {
    const { number } = req.body;
    
    // Check if web control is configured
    if (!config.discord.webUserId || !config.discord.webGuildId || !config.discord.webChannelId) {
      return res.json({ success: false, error: 'Web control not configured. Set WEB_USER_ID, WEB_GUILD_ID, and WEB_CHANNEL_ID in .env' });
    }
    
    // Get search results from Plex
    const results = await plexClient.search(''); // This needs to be stored per session
    if (!results || results.length < number) {
      return res.json({ success: false, error: 'Invalid result number or search expired' });
    }
    
    const item = results[number - 1];
    const streamInfo = await plexClient.getDirectStreamUrl(item.ratingKey);
    if (!streamInfo) {
      return res.json({ success: false, error: 'Failed to get stream URL' });
    }
    
    const streamer = getVideoStreamer();
    await streamer.startStream(
      config.discord.webGuildId,
      config.discord.webChannelId,
      item,
      streamInfo.url,
      0,
      config.discord.webUserId
    );
    
    res.json({ success: true, message: `Playing: ${item.title}` });
  } catch (error) {
    res.json({ success: false, error: 'Play failed' });
  }
});

app.post('/api/control/pause', async (req: Request, res: Response) => {
  try {
    const streamer = getVideoStreamer();
    const guildIds = streamer.getAllSessions();
    if (guildIds.length === 0) {
      return res.json({ success: false, error: 'No active stream' });
    }
    const guildId = guildIds[0];
    const session = streamer.getSession(guildId);
    if (session?.isPaused) {
      await streamer.resumeStream(guildId);
      res.json({ success: true, message: 'Resumed' });
    } else {
      await streamer.pauseStream(guildId);
      res.json({ success: true, message: 'Paused' });
    }
  } catch (error) {
    res.json({ success: false, error: 'Pause/resume failed' });
  }
});

app.post('/api/control/stop', async (req: Request, res: Response) => {
  try {
    const streamer = getVideoStreamer();
    const guildIds = streamer.getAllSessions();
    if (guildIds.length === 0) {
      return res.json({ success: false, error: 'No active stream' });
    }
    await streamer.stopStream(guildIds[0]);
    res.json({ success: true, message: 'Stream stopped' });
  } catch (error) {
    res.json({ success: false, error: 'Stop failed' });
  }
});

app.post('/api/control/seek', async (req: Request, res: Response) => {
  try {
    const { time } = req.body;
    const streamer = getVideoStreamer();
    const guildIds = streamer.getAllSessions();
    if (guildIds.length === 0) {
      return res.json({ success: false, error: 'No active stream' });
    }
    const timeMs = parseTimeString(time);
    if (timeMs === null) {
      return res.json({ success: false, error: 'Invalid time format' });
    }
    await streamer.seekStream(guildIds[0], timeMs);
    res.json({ success: true, message: `Seeked to ${time}` });
  } catch (error) {
    res.json({ success: false, error: 'Seek failed' });
  }
});

app.post('/api/control/skip', async (req: Request, res: Response) => {
  try {
    res.json({ success: false, error: 'Skip requires Discord bot context for next episode lookup' });
  } catch (error) {
    res.json({ success: false, error: 'Skip failed' });
  }
});

app.post('/api/control/ff', async (req: Request, res: Response) => {
  try {
    const { time = '30s' } = req.body;
    const streamer = getVideoStreamer();
    const guildIds = streamer.getAllSessions();
    if (guildIds.length === 0) {
      return res.json({ success: false, error: 'No active stream' });
    }
    const guildId = guildIds[0];
    const currentTime = streamer.getCurrentTime(guildId);
    const skipMs = parseTimeString(time);
    if (skipMs === null) {
      return res.json({ success: false, error: 'Invalid time format' });
    }
    await streamer.seekStream(guildId, currentTime + skipMs);
    res.json({ success: true, message: `Fast forwarded ${time}` });
  } catch (error) {
    res.json({ success: false, error: 'Fast forward failed' });
  }
});

app.post('/api/control/volume', async (req: Request, res: Response) => {
  try {
    const { level } = req.body;
    const streamer = getVideoStreamer();
    const guildIds = streamer.getAllSessions();
    if (guildIds.length === 0) {
      return res.json({ success: false, error: 'No active stream' });
    }
    await streamer.setVolume(guildIds[0], level);
    res.json({ success: true, message: `Volume set to ${level}%` });
  } catch (error) {
    res.json({ success: false, error: 'Volume change failed' });
  }
});

app.post('/api/control/youtube', async (req: Request, res: Response) => {
  try {
    const { url } = req.body;
    
    if (!config.discord.webUserId || !config.discord.webGuildId || !config.discord.webChannelId) {
      return res.json({ success: false, error: 'Web control not configured. Set WEB_USER_ID, WEB_GUILD_ID, and WEB_CHANNEL_ID in .env' });
    }
    
    // Get video info using yt-dlp (same as controller bot)
    const info = await new Promise<any>((resolve) => {
      const ytdlp = spawn('yt-dlp', ['--dump-json', '--no-playlist', '--no-warnings', url]);
      let output = '';
      ytdlp.stdout.on('data', (data) => output += data.toString());
      ytdlp.on('close', (code) => {
        if (code !== 0 || !output) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(output));
        } catch {
          resolve(null);
        }
      });
    });

    if (!info) {
      return res.json({ success: false, error: 'Failed to get video info' });
    }

    // Get stream URLs using yt-dlp -g flag (same approach as controller bot)
    const urls = await new Promise<{ video: string; audio: string | null } | null>((resolve) => {
      const ytdlp = spawn('yt-dlp', [
        '-g',
        '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
        '--no-playlist',
        '--no-warnings',
        url
      ]);
      let output = '';
      ytdlp.stdout.on('data', (data) => output += data.toString());
      ytdlp.on('close', (code) => {
        if (code !== 0 || !output) {
          resolve(null);
          return;
        }
        const lines = output.trim().split('\n');
        resolve({
          video: lines[0],
          audio: lines[1] || null
        });
      });
    });

    if (!urls) {
      return res.json({ success: false, error: 'Failed to get stream URLs' });
    }

    console.log('[WebServer] YouTube video URL:', urls.video.substring(0, 100) + '...');
    console.log('[WebServer] YouTube audio URL:', urls.audio ? urls.audio.substring(0, 100) + '...' : 'none (merged format)');
    
    const streamer = getVideoStreamer();
    await streamer.startExternalStream(
      config.discord.webGuildId,
      config.discord.webChannelId,
      {
        title: info.title || 'YouTube Video',
        ratingKey: info.id,
        key: `/library/metadata/${info.id}`,
        type: 'movie',
        duration: (info.duration || 0) * 1000,
      },
      urls.video,
      config.discord.webUserId,
      urls.audio
    );
    
    res.json({ success: true, message: `Playing: ${info.title}` });
  } catch (error) {
    console.error('[WebServer] YouTube playback error:', error);
    res.json({ success: false, error: 'YouTube playback failed' });
  }
});

app.post('/api/control/youtube-search', async (req: Request, res: Response) => {
  try {
    const { query } = req.body;
    
    const ytdlp = spawn('yt-dlp', [
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      '-I', '1:20',
      `ytsearch20:${query}`
    ]);
    
    let output = '';
    ytdlp.stdout.on('data', (data) => output += data.toString());
    
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
                views: data.view_count ? `${(data.view_count / 1000000).toFixed(1)}M views` : '',
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

app.post('/api/control/url', async (req: Request, res: Response) => {
  try {
    const { url, title } = req.body;
    
    if (!config.discord.webUserId || !config.discord.webGuildId || !config.discord.webChannelId) {
      return res.json({ success: false, error: 'Web control not configured. Set WEB_USER_ID, WEB_GUILD_ID, and WEB_CHANNEL_ID in .env' });
    }
    
    const streamer = getVideoStreamer();
    await streamer.startExternalStream(
      config.discord.webGuildId,
      config.discord.webChannelId,
      {
        title: title || 'External Stream',
        ratingKey: url,
        key: `/library/metadata/${url}`,
        type: 'movie',
        duration: 0,
      },
      url,
      config.discord.webUserId,
      null
    );
    
    res.json({ success: true, message: `Playing: ${title || 'External Stream'}` });
  } catch (error) {
    res.json({ success: false, error: 'URL playback failed' });
  }
});

// Stream proxy endpoint - serves FFmpeg-processed stream synced to Discord
app.get('/api/stream/:guildId/hls', async (req: Request, res: Response) => {
  const { guildId } = req.params;
  const streamer = getVideoStreamer();
  const session = streamer.getSession(guildId);
  
  if (!session) {
    return res.status(404).json({ error: 'Stream not found' });
  }

  try {
    const { spawn } = await import('child_process');
    
    // Detect if this is an HLS stream (external masked) or direct video (YouTube/Plex)
    // Only use HLSFetcher for masked streams with .json/.svg/.php/.txt/.js extensions
    // YouTube and Plex streams should use direct FFmpeg input
    const needsHLSFetcher = (session.streamUrl.includes('.json') || 
                            session.streamUrl.includes('.svg') || 
                            session.streamUrl.includes('.php') ||
                            session.streamUrl.includes('.txt') ||
                            session.streamUrl.includes('.js')) &&
                            !session.streamUrl.includes('googlevideo.com') &&
                            !session.streamUrl.includes('plex');
    
    // Get current playback position from Discord stream to sync
    const progress = streamer.getProgress(guildId);
    const STARTUP_OFFSET = 15; // seconds to add for FFmpeg startup time
    const seekSeconds = Math.max(0, Math.floor(progress.current / 1000) + STARTUP_OFFSET);
    
    let hlsFetcherProcess: ReturnType<typeof spawn> | null = null;
    let ffmpegArgs: string[];
    
    if (needsHLSFetcher) {
      console.log(`[WebServer] Starting FFmpeg proxy for guild ${guildId} (HLS via custom fetcher)`);
      
      // Use custom HLS fetcher that downloads segments directly
      const { createHLSFetcherProcess } = await import('../stream/hls-fetcher.js');
      hlsFetcherProcess = createHLSFetcherProcess(session.streamUrl);
      
      // Build FFmpeg args to read MPEG-TS from HLSFetcher stdin
      ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-f', 'mpegts', // Raw MPEG-TS input from HLSFetcher
        '-i', 'pipe:0', // Read from stdin
      ];
    } else {
      console.log(`[WebServer] Starting FFmpeg proxy for guild ${guildId}, seeking to ${seekSeconds}s (current: ${Math.floor(progress.current / 1000)}s + ${STARTUP_OFFSET}s offset)`);
      
      // Build FFmpeg args for direct streams (YouTube)
      ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'warning',
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
        '-ss', seekSeconds.toString(),
        '-i', session.streamUrl,
      ];
      
      // Add audio input if separate (YouTube)
      if (session.audioUrl) {
        ffmpegArgs.push(
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '5',
          '-ss', seekSeconds.toString(),
          '-i', session.audioUrl
        );
      }
    }

    // Output args - optimized for low-memory streaming
    ffmpegArgs.push(
      '-map', '0:v:0?',
      '-map', session.audioUrl ? '1:a:0?' : '0:a:0?',
      // Video: lower bitrate, faster encoding, small GOP for low latency
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-b:v', '2500k',
      '-maxrate', '3000k',
      '-bufsize', '1000k',
      '-g', '30', // Keyframe every 30 frames (1 sec at 30fps)
      // Audio
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-ac', '2',
      // Output format with small fragments for memory efficiency
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-frag_duration', '1000000', // 1 second fragments
      '-min_frag_duration', '500000', // Min 0.5 second
      'pipe:1'
    );

    console.log('[WebServer] Starting FFmpeg proxy for guild:', guildId);
    
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    
    // If using HLSFetcher, pipe its output to FFmpeg stdin
    if (hlsFetcherProcess && hlsFetcherProcess.stdout) {
      hlsFetcherProcess.stdout.on('error', (err: Error) => {
        // Ignore EPIPE errors when FFmpeg closes stdin
        if ((err as any).code !== 'EPIPE') {
          console.error('[WebServer] HLSFetcher stdout error:', err);
        }
      });
      
      hlsFetcherProcess.stdout.pipe(ffmpeg.stdin);
      
      hlsFetcherProcess.on('error', (err: Error) => {
        console.error('[WebServer] HLSFetcher error:', err);
      });
      
      hlsFetcherProcess.on('exit', (code: number | null) => {
        if (code !== 0 && code !== null) {
          console.log('[WebServer] HLSFetcher exited with code:', code);
        }
      });
    }
    
    // Set headers for streaming
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Pipe FFmpeg output to response
    ffmpeg.stdout.pipe(res);
    
    ffmpeg.stderr.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg) {
        console.log('[WebServer FFmpeg]', msg);
      }
    });
    
    ffmpeg.on('error', (err: Error) => {
      console.error('[WebServer] FFmpeg error:', err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Stream processing failed' });
      }
    });
    
    ffmpeg.on('exit', (code: number | null) => {
      console.log('[WebServer] FFmpeg exited with code:', code);
      if (hlsFetcherProcess && !hlsFetcherProcess.killed) {
        hlsFetcherProcess.kill();
      }
      if (!res.headersSent) {
        res.end();
      }
    });
    
    // Clean up on client disconnect
    req.on('close', () => {
      console.log('[WebServer] Client disconnected, killing FFmpeg');
      ffmpeg.kill('SIGKILL');
      if (hlsFetcherProcess && !hlsFetcherProcess.killed) {
        hlsFetcherProcess.kill();
      }
    });
    
  } catch (error) {
    console.error('[WebServer] Stream proxy error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to start stream proxy' });
    }
  }
});

// Serve React SPA for all non-API routes
app.get('/{*path}', (req: Request, res: Response) => {
  // Don't serve HTML for API routes
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.sendFile(join(process.cwd(), 'public', 'index.html'));
});

// Export functions for integration
export function registerWebStream(guildId: string, session: VideoStreamSession, streamUrl: string): void {
  webStreamSessions.set(guildId, {
    session,
    streamUrl,
    startedAt: Date.now(),
  });
  console.log(`[WebServer] Registered stream for guild ${guildId}`);
  console.log(`[WebServer] View at: http://localhost:${PORT}/player/${guildId}`);
}

export function unregisterWebStream(guildId: string): void {
  webStreamSessions.delete(guildId);
  console.log(`[WebServer] Unregistered stream for guild ${guildId}`);
}

export function startWebServer(): void {
  app.listen(PORT, () => {
    console.log(`[WebServer] Started on http://localhost:${PORT}`);
    console.log(`[WebServer] Stream viewer available at http://localhost:${PORT}`);
  });
}

export default app;
