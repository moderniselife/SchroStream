import express, { Request, Response } from 'express';
import cors from 'cors';
import { join } from 'path';
import { getVideoStreamer } from '../stream/video-streamer.js';
import type { VideoStreamSession } from '../stream/video-streamer.js';

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
    
    // Detect if this is an HLS stream (external) or direct video (YouTube)
    const needsHLSFetcher = session.streamUrl.includes('.json') || 
                            session.streamUrl.includes('.svg') || 
                            session.streamUrl.includes('.php') ||
                            session.streamUrl.includes('.txt') ||
                            session.streamUrl.includes('.js') ||
                            session.streamUrl.includes('.m3u8');
    
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
