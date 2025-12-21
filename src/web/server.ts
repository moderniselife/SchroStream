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

// Stream proxy endpoint - serves FFmpeg-processed HLS stream
app.get('/api/stream/:guildId/hls', async (req: Request, res: Response) => {
  const { guildId } = req.params;
  const streamer = getVideoStreamer();
  const session = streamer.getSession(guildId);
  
  if (!session) {
    return res.status(404).json({ error: 'Stream not found' });
  }

  try {
    const { spawn } = await import('child_process');
    const config = (await import('../config.js')).default;
    
    const height = config.stream.defaultQuality;
    const width = Math.round(height * (16 / 9));
    
    // Build FFmpeg args to process and serve as HLS
    const ffmpegArgs = [
      '-hide_banner',
      '-loglevel', 'error',
      '-reconnect', '1',
      '-reconnect_streamed', '1',
      '-reconnect_delay_max', '5',
      '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
      '-i', session.streamUrl,
    ];

    // Add audio input if separate (YouTube)
    if (session.audioUrl) {
      ffmpegArgs.push(
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', session.audioUrl
      );
    }

    // Output args - use fragmented MP4 for universal browser support
    ffmpegArgs.push(
      '-map', '0:v:0?',
      '-map', session.audioUrl ? '1:a:0?' : '0:a:0?',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      '-ac', '2',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+faststart',
      'pipe:1'
    );

    console.log('[WebServer] Starting FFmpeg proxy for guild:', guildId);
    
    const ffmpeg = spawn('ffmpeg', ffmpegArgs);
    
    // Set headers for streaming
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Pipe FFmpeg output to response
    ffmpeg.stdout.pipe(res);
    
    ffmpeg.stderr.on('data', (data: Buffer) => {
      const msg = data.toString().trim();
      if (msg && msg.includes('error')) {
        console.error('[WebServer FFmpeg]', msg);
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
      if (!res.headersSent) {
        res.end();
      }
    });
    
    // Clean up on client disconnect
    req.on('close', () => {
      console.log('[WebServer] Client disconnected, killing FFmpeg');
      ffmpeg.kill('SIGKILL');
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
