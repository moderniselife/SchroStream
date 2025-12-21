import express, { Request, Response } from 'express';
import cors from 'cors';
import { join } from 'path';
import { getVideoStreamer } from '../stream/video-streamer.js';
import type { VideoStreamSession } from '../stream/video-streamer.js';

const app = express();
const PORT = process.env.WEB_PORT || 3000;

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

// Proxy endpoint for streams (to avoid CORS issues)
app.get('/api/proxy/:guildId', async (req: Request, res: Response) => {
  const { guildId } = req.params;
  const streamer = getVideoStreamer();
  const session = streamer.getSession(guildId);
  
  if (!session) {
    return res.status(404).json({ error: 'Stream not found' });
  }
  
  try {
    const response = await fetch(session.streamUrl);
    
    // Forward headers
    response.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    
    // Pipe the stream
    const reader = response.body?.getReader();
    if (!reader) {
      return res.status(500).json({ error: 'Failed to read stream' });
    }
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    
    res.end();
  } catch (error) {
    console.error('[WebServer] Proxy error:', error);
    res.status(500).json({ error: 'Failed to proxy stream' });
  }
});

// HTML page route
app.get('/', (req: Request, res: Response) => {
  res.sendFile(join(process.cwd(), 'public', 'index.html'));
});

app.get('/player/:guildId', (req: Request, res: Response) => {
  res.sendFile(join(process.cwd(), 'public', 'player.html'));
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
