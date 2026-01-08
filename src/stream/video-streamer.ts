import { Streamer, prepareStream, playStream, Utils } from '@dank074/discord-video-stream';
import { Client } from 'discord.js-selfbot-v13';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { MediaItem } from '../types/index.js';
import config from '../config.js';
import plexClient from '../plex/client.js';
import { updateWatchDeck } from '../data/watch-deck.js';
import { popQueue, peekQueue } from '../data/queue.js';

// Playback history file path
const HISTORY_FILE = join(process.cwd(), 'data', 'playback-history.json');

export interface VideoStreamSession {
  guildId: string;
  channelId: string;
  mediaItem: MediaItem;
  streamUrl: string;
  isPaused: boolean;
  isStopping: boolean; // Flag to track intentional stop (pause/seek)
  isPlaying: boolean; // Flag to track if stream actually started playing
  startedAt: number;
  currentTime: number;
  duration: number;
  volume: number;
  ffmpegCommand: any | null;
  userId?: string;
  isExternal?: boolean; // Flag for external streams (YouTube, URLs)
  audioUrl?: string; // Separate audio URL for YouTube streams
  sessionId?: string; // Plex transcode session ID for reuse
}

// Store playback positions for resume functionality (ratingKey -> position in ms)
interface PlaybackHistoryEntry {
  position: number;
  updatedAt: number;
  title?: string;
}

let playbackHistory: Map<string, PlaybackHistoryEntry> = new Map();

// Status update timer
let statusUpdateTimer: NodeJS.Timeout | null = null;

// Function to set initial bot statuses (without position for Discord auto-tracking)
async function setInitialBotStatuses(session: VideoStreamSession): Promise<void> {
  try {
    // Format title based on media type
    let titleText = session.mediaItem.title;
    if (session.mediaItem.type === 'show' && session.mediaItem.parentIndex && session.mediaItem.index) {
      // TV show: "Show Name S01E02"
      titleText = `${session.mediaItem.grandparentTitle || session.mediaItem.title} S${String(session.mediaItem.parentIndex).padStart(2, '0')}E${String(session.mediaItem.index).padStart(2, '0')}`;
    } else if (session.mediaItem.type === 'episode') {
      // Individual episode: "Show Name S01E02: Episode Title"
      const showName = session.mediaItem.grandparentTitle || 'Unknown Show';
      const season = session.mediaItem.parentIndex || 0;
      const episode = session.mediaItem.index || 0;
      titleText = `${showName} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}: ${session.mediaItem.title}`;
    }
    // For movies, just use the title as-is
    
    // Update controller bot status (without position for Discord auto-tracking)
    const { getControllerBot } = await import('../controller/bot.js');
    const controllerBot = getControllerBot();
    if (controllerBot?.user) {
      await controllerBot.user.setPresence({
        status: 'online',
        activities: [{
          name: titleText,
          type: 0 // PLAYING
        }]
      });
    }
    
    // Update selfbot status (without position for Discord auto-tracking)
    const { client } = await import('../bot/client.js');
    if (client?.user) {
      await client.user.setActivity(titleText, { type: 'PLAYING' });
    }
    
    console.log(`[Status] Initial: ${titleText}`);
  } catch (error) {
    console.error('[Status] Failed to set initial bot statuses:', error);
  }
}

// Function to update bot statuses with position
async function updateBotStatuses(session: VideoStreamSession): Promise<void> {
  try {
    // Calculate current position
    const elapsed = Date.now() - session.startedAt;
    const currentPos = session.isPaused ? session.currentTime : session.currentTime + elapsed;
    
    // Format position as MM:SS / HH:MM:SS
    const formatTime = (ms: number): string => {
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      
      if (hours > 0) {
        return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      }
      return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
    };
    
    const currentPosStr = formatTime(currentPos);
    const durationStr = session.duration ? formatTime(session.duration) : 'Live';
    
    // Format title based on media type
    let titleText = session.mediaItem.title;
    if (session.mediaItem.type === 'show' && session.mediaItem.parentIndex && session.mediaItem.index) {
      // TV show: "Show Name S01E02"
      titleText = `${session.mediaItem.grandparentTitle || session.mediaItem.title} S${String(session.mediaItem.parentIndex).padStart(2, '0')}E${String(session.mediaItem.index).padStart(2, '0')}`;
    } else if (session.mediaItem.type === 'episode') {
      // Individual episode: "Show Name S01E02: Episode Title"
      const showName = session.mediaItem.grandparentTitle || 'Unknown Show';
      const season = session.mediaItem.parentIndex || 0;
      const episode = session.mediaItem.index || 0;
      titleText = `${showName} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}: ${session.mediaItem.title}`;
    }
    // For movies, just use the title as-is
    
    const statusText = `${titleText} (${currentPosStr}${session.duration ? '/' + durationStr : ''})`;
    
    // Update controller bot status (with position)
    const { getControllerBot } = await import('../controller/bot.js');
    const controllerBot = getControllerBot();
    if (controllerBot?.user) {
      await controllerBot.user.setPresence({
        status: 'online',
        activities: [{
          name: statusText,
          type: 0 // PLAYING
        }]
      });
    }
    
    // Update selfbot status (with position)
    const { client } = await import('../bot/client.js');
    if (client?.user) {
      await client.user.setActivity(statusText, { type: 'PLAYING' });
    }
    
    console.log(`[Status] Updated: ${statusText}`);
  } catch (error) {
    console.error('[Status] Failed to update bot statuses:', error);
  }
}

// Function to clear bot statuses
async function clearBotStatuses(): Promise<void> {
  try {
    // Clear controller bot status
    const { getControllerBot } = await import('../controller/bot.js');
    const controllerBot = getControllerBot();
    if (controllerBot?.user) {
      await controllerBot.user.setPresence({
        status: 'online',
        activities: [{
          name: '/help for commands',
          type: 2 // LISTENING
        }]
      });
    }
    
    // Clear selfbot status
    const { client } = await import('../bot/client.js');
    if (client?.user) {
      await client.user.setActivity(undefined);
    }
    
    console.log('[Status] Cleared bot statuses');
  } catch (error) {
    console.error('[Status] Failed to clear bot statuses:', error);
  }
}

// Start status update timer
function startStatusUpdateTimer(session: VideoStreamSession): void {
  // Clear existing timer
  if (statusUpdateTimer) {
    clearInterval(statusUpdateTimer);
  }
  
  // Set initial status without position (for Discord auto-tracking)
  setInitialBotStatuses(session);
  
  // Update with position every 5 seconds
  statusUpdateTimer = setInterval(() => {
    updateBotStatuses(session);
  }, 5000);
}

// Stop status update timer
function stopStatusUpdateTimer(): void {
  if (statusUpdateTimer) {
    clearInterval(statusUpdateTimer);
    statusUpdateTimer = null;
    clearBotStatuses();
  }
}

// Load playback history from disk
function loadPlaybackHistory(): void {
  try {
    if (existsSync(HISTORY_FILE)) {
      const data = readFileSync(HISTORY_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      playbackHistory = new Map(Object.entries(parsed));
      console.log(`[PlaybackHistory] Loaded ${playbackHistory.size} entries from disk`);
    }
  } catch (error) {
    console.error('[PlaybackHistory] Failed to load:', error);
    playbackHistory = new Map();
  }
}

// Save playback history to disk
function persistPlaybackHistory(): void {
  try {
    // Ensure data directory exists
    const dataDir = join(process.cwd(), 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
      console.log('[PlaybackHistory] Created data directory');
    }
    
    const obj = Object.fromEntries(playbackHistory);
    writeFileSync(HISTORY_FILE, JSON.stringify(obj, null, 2));
    console.log(`[PlaybackHistory] Saved ${playbackHistory.size} entries to disk`);
  } catch (error) {
    console.error('[PlaybackHistory] Failed to save:', error);
  }
}

// Initialize on module load
loadPlaybackHistory();

export function getPlaybackPosition(ratingKey: string): number | null {
  const history = playbackHistory.get(ratingKey);
  if (!history) return null;
  // Expire after 7 days
  if (Date.now() - history.updatedAt > 7 * 24 * 60 * 60 * 1000) {
    playbackHistory.delete(ratingKey);
    persistPlaybackHistory();
    return null;
  }
  return history.position;
}

export function savePlaybackPosition(ratingKey: string, position: number, title?: string): void {
  // Don't save if position is less than 30 seconds (likely a failed/aborted stream)
  if (position < 30000) {
    console.log(`[PlaybackHistory] Skipping save for ${ratingKey} - position too small: ${position}ms`);
    return;
  }
  console.log(`[PlaybackHistory] Saving ${ratingKey} at position ${position}ms`);
  playbackHistory.set(ratingKey, { position, updatedAt: Date.now(), title });
  persistPlaybackHistory();
}

export function clearPlaybackPosition(ratingKey: string): void {
  playbackHistory.delete(ratingKey);
  persistPlaybackHistory();
}

class VideoStreamer {
  public streamer: Streamer;
  private sessions: Map<string, VideoStreamSession> = new Map();

  constructor(client: Client) {
    this.streamer = new Streamer(client);
  }

  get client(): Client {
    return this.streamer.client;
  }

  getSession(guildId: string): VideoStreamSession | null {
    return this.sessions.get(guildId) || null;
  }

  isStreaming(guildId: string): boolean {
    return this.sessions.has(guildId);
  }

  private async playNextInQueue(guildId: string, channelId: string, userId?: string): Promise<void> {
    const nextItem = popQueue();
    if (!nextItem) {
      console.log('[VideoStreamer] Queue is empty, playback stopped');
      return;
    }

    console.log(`[VideoStreamer] Auto-playing next in queue: ${nextItem.title}`);

    try {
      // Get the full media item from Plex
      const mediaItem = await plexClient.getMetadata(nextItem.ratingKey);
      if (!mediaItem) {
        console.error('[VideoStreamer] Could not find media item in Plex');
        // Try next item in queue
        await this.playNextInQueue(guildId, channelId, userId);
        return;
      }

      // Get stream URL
      const streamInfo = await plexClient.getDirectStreamUrl(nextItem.ratingKey);
      if (!streamInfo) {
        console.error('[VideoStreamer] Could not get stream URL');
        // Try next item in queue
        await this.playNextInQueue(guildId, channelId, userId);
        return;
      }

      // Check for saved position
      const savedPosition = getPlaybackPosition(nextItem.ratingKey);
      const startPosition = (savedPosition && savedPosition > 30000) ? savedPosition : 0;

      // Start streaming the next item
      await this.startStream(guildId, channelId, mediaItem, streamInfo.url, startPosition, userId);
    } catch (error) {
      console.error('[VideoStreamer] Error playing next in queue:', error);
      // Try next item in queue
      await this.playNextInQueue(guildId, channelId, userId);
    }
  }

  async startStream(
    guildId: string,
    channelId: string,
    mediaItem: MediaItem,
    streamUrl: string,
    startTimeMs = 0,
    userId?: string
  ): Promise<void> {
    await this.stopStream(guildId);

    await this.streamer.joinVoice(guildId, channelId);

    const session: VideoStreamSession = {
      guildId,
      channelId,
      mediaItem,
      streamUrl,
      isPaused: false,
      isStopping: false,
      isPlaying: false,
      startedAt: Date.now(),
      currentTime: startTimeMs,
      duration: mediaItem.duration || 0,
      volume: 100,
      ffmpegCommand: null,
      userId,
      isExternal: mediaItem.type === 'channel', // Treat Live TV channels as external streams
    };

    this.sessions.set(guildId, session);
    
    // Start status update timer
    startStatusUpdateTimer(session);

    // Play Live TV channels as external streams to skip Plex transcoding
    if (mediaItem.type === 'channel') {
      console.log('[VideoStreamer] Playing Live TV channel as external stream');
      await this.playExternalStream(session, startTimeMs);
    } else {
      await this.playVideoStream(session, startTimeMs);
    }
  }

  async startLocalFile(
    guildId: string,
    channelId: string,
    mediaItem: MediaItem,
    filePath: string,
    userId?: string
  ): Promise<void> {
    await this.stopStream(guildId);

    await this.streamer.joinVoice(guildId, channelId);

    const session: VideoStreamSession = {
      guildId,
      channelId,
      mediaItem,
      streamUrl: filePath, // Use file path as stream URL
      isPaused: false,
      isStopping: false,
      isPlaying: false,
      startedAt: Date.now(),
      currentTime: 0,
      duration: mediaItem.duration || 0,
      volume: 100,
      ffmpegCommand: null,
      userId,
      isExternal: true, // Treat local files as external streams
      audioUrl: undefined,
    };

    this.sessions.set(guildId, session);
    
    // Start status update timer
    startStatusUpdateTimer(session);

    await this.playLocalFile(session);
  }

  async startExternalStream(
    guildId: string,
    channelId: string,
    mediaItem: MediaItem,
    streamUrl: string,
    userId?: string,
    audioUrl?: string | null
  ): Promise<void> {
    await this.stopStream(guildId);

    await this.streamer.joinVoice(guildId, channelId);

    // Extract session ID from stream URL
    const urlObj = new URL(streamUrl);
    const sessionId = urlObj.searchParams.get('X-Plex-Session-Identifier') || 
                    urlObj.searchParams.get('session') || undefined;

    const session: VideoStreamSession = {
      guildId,
      channelId,
      mediaItem,
      streamUrl,
      isPaused: false,
      isStopping: false,
      isPlaying: false,
      startedAt: Date.now(),
      currentTime: 0,
      duration: mediaItem.duration || 0,
      volume: 100,
      ffmpegCommand: null,
      userId,
      isExternal: true,
      audioUrl: audioUrl || undefined,
      sessionId,
    };

    this.sessions.set(guildId, session);
    
    // Start status update timer
    startStatusUpdateTimer(session);

    this.playExternalStream(session);
  }

  private async playLocalFile(session: VideoStreamSession, startTimeMs: number = 0): Promise<void> {
    const height = config.stream.defaultQuality;
    const width = Math.round(height * (16 / 9));
    
    console.log(`[VideoStreamer] Encoding local file at ${width}x${height} (quality: ${height}p)`);

    try {
      const startTimeSec = Math.floor(startTimeMs / 1000);
      console.log('[VideoStreamer] Playing local file:', session.streamUrl);
      if (startTimeSec > 0) {
        console.log(`[VideoStreamer] Starting local file at ${startTimeSec}s`);
      }

      const volumeMultiplier = (session.volume / 100).toFixed(2);

      // Build FFmpeg args for local file input
      const ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'error',
      ];

      ffmpegArgs.push('-i', session.streamUrl);

      // Add seek AFTER input for better compatibility with processed videos
      if (startTimeSec > 0) {
        // Validate seek position against video duration
        if (session.duration && startTimeSec > session.duration) {
          console.log(`[VideoStreamer] Seek position ${startTimeSec}s exceeds video duration ${session.duration}s, seeking to end`);
          ffmpegArgs.push('-ss', Math.max(0, session.duration - 5).toString()); // Seek to 5s before end
        } else {
          ffmpegArgs.push('-ss', startTimeSec.toString());
        }
      }

      // Video and audio output settings - maximum compatibility for processed videos
      // Force re-encoding to ensure H.264 compatibility with Discord
      // AV1 and other codecs are not supported by Discord video streaming
      const needsReencode = true; // Always re-encode for Discord compatibility
      
      if (needsReencode) {
        // Adjust bitrate based on quality for optimal encoding
        const qualityBitrate = height >= 1080 ? config.stream.maxBitrate : 
                              height >= 720 ? Math.floor(config.stream.maxBitrate * 0.6) :
                              Math.floor(config.stream.maxBitrate * 0.4);
        
        console.log(`[VideoStreamer] Re-encoding at ${qualityBitrate}k bitrate for ${height}p video`);
        
        ffmpegArgs.push(
          '-map', '0:v:0?',
          '-map', '0:a:0?',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-tune', 'fastdecode',
          '-pix_fmt', 'yuv420p',
          '-r', String(config.stream.frameRate),
          '-g', '30',
          '-keyint_min', '15',
          '-b:v', `${qualityBitrate}k`,
          '-maxrate', `${qualityBitrate * 1.5}k`,
          '-bufsize', `${qualityBitrate * 2}k`,
          '-x264-params', 'scenecut=0:lookahead=0',
          '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=fps=${config.stream.frameRate}:round=up`,
          '-c:a', 'libopus',
          '-b:a', '128k',
          '-ar', '48000',
          '-ac', '2',
          '-af', `volume=${volumeMultiplier}`,
          '-f', 'matroska',
          '-'
        );
      } else {
        // Stream copy - minimal processing, maximum performance
        console.log(`[VideoStreamer] Using stream copy for local file (no re-encoding)`);
        
        ffmpegArgs.push(
          '-map', '0:v:0?',
          '-map', '0:a:0?',
          '-c:v', 'copy', // Copy video stream directly - no re-encoding
          '-c:a', 'libopus', // Audio needs re-encoding for Discord
          '-b:a', '128k',
          '-ar', '48000',
          '-ac', '2',
          '-af', `volume=${volumeMultiplier}`,
          '-f', 'matroska',
          '-'
        );
      }

      console.log('[VideoStreamer] Starting FFmpeg for local file...');
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      session.ffmpegCommand = ffmpeg;

      ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString();
        // Always show errors, but only show other logs if enabled
        if (msg.includes('Error') || msg.includes('error') || msg.includes('Fatal')) {
          console.error('[FFmpeg]', msg);
        } else if (msg.includes('codec_id') && msg.includes('225')) {
          // AV1 codec detected - log why we need to re-encode
          console.warn('[FFmpeg] AV1 codec detected - re-encoding required for Discord compatibility');
        } else if (msg.includes('frame=') && msg.includes('fps=')) {
          // Debug frame processing to detect video freezing
          if (config.stream.showFFmpegLogs) {
            console.log('[FFmpeg]', msg.trim());
          }
        } else if (msg.includes('dropping') || msg.includes('delay')) {
          // Log frame drops or delays which could cause freezing
          console.warn('[FFmpeg] Frame issue:', msg.trim());
        } else if (config.stream.showFFmpegLogs && !msg.includes('size=')) {
          console.error('[FFmpeg]', msg);
        }
      });

      ffmpeg.on('error', (err) => {
        console.error('[VideoStreamer] FFmpeg spawn error:', err.message);
      });

      ffmpeg.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.log('[VideoStreamer] FFmpeg exited with code:', code);
          if (code === 255 && startTimeSec > 0) {
            console.error('[VideoStreamer] FFmpeg exit code 255 - seek error, retrying without seek');
            // Retry without seek if it was a seek failure
            setTimeout(() => {
              console.log('[VideoStreamer] Retrying local file playback from start');
              this.playLocalFile(session, 0);
            }, 1000);
          }
        } else if (code === 0) {
          // FFmpeg exited normally (video finished)
          console.log('[VideoStreamer] FFmpeg exited normally - video finished');
          
          // Use the same cleanup logic as the normal stream end
          if (!session.isStopping) {
            console.log('[VideoStreamer] Local file playback finished');
            this.sessions.delete(session.guildId);
            
            // Auto-play next item in queue
            this.playNextInQueue(session.guildId, session.channelId, session.userId);
          }
        }
      });

      console.log('[VideoStreamer] Starting Go Live stream (local file)...');
      
      session.isPlaying = true;
      session.startedAt = Date.now();
      
      if (session.userId) {
        updateWatchDeck(session.mediaItem, 0, session.userId);
      }

      // Register stream for web viewing
      const { registerWebStream } = await import('../web/server.js');
      registerWebStream(session.guildId, session, session.streamUrl);

      await playStream(ffmpeg.stdout, this.streamer, {
        type: 'go-live',
      });

      console.log('[VideoStreamer] Local file playback finished');
      
      if (!session.isStopping) {
        this.sessions.delete(session.guildId);
        
        // Auto-play next item in queue
        await this.playNextInQueue(session.guildId, session.channelId, session.userId);
      }
    } catch (error) {
      if (!session.isStopping && error instanceof Error && !error.message.includes('abort')) {
        console.error('[VideoStreamer] Local file error:', error);
      }
      
      if (!session.isStopping) {
        this.sessions.delete(session.guildId);
      }
    }
  }

  private async playExternalStream(session: VideoStreamSession, startTimeMs: number = 0): Promise<void> {
    const height = config.stream.defaultQuality;
    const width = Math.round(height * (16 / 9));
    let streamlinkProcess: ReturnType<typeof spawn> | null = null;

    try {
      const startTimeSec = Math.floor(startTimeMs / 1000);
      console.log('[VideoStreamer] External stream URL:', session.streamUrl.substring(0, 100) + '...');
      if (session.audioUrl) {
        console.log('[VideoStreamer] Separate audio URL:', session.audioUrl.substring(0, 100) + '...');
      }
      if (startTimeSec > 0) {
        console.log(`[VideoStreamer] Starting external stream at ${startTimeSec}s`);
      }

      const volumeMultiplier = (session.volume / 100).toFixed(2);

      // Check if this is a problematic stream that needs streamlink
      const needsStreamlink = session.streamUrl.includes('.json') || 
                              session.streamUrl.includes('.svg') || 
                              session.streamUrl.includes('.php') ||
                              session.streamUrl.includes('.txt') ||
                              session.streamUrl.includes('.js');

      let ffmpegArgs: string[];

      if (needsStreamlink) {
        console.log('[VideoStreamer] Using custom HLS fetcher for problematic stream...');
        
        // Use custom HLS fetcher that downloads segments directly
        const { createHLSFetcherProcess } = await import('./hls-fetcher.js');
        streamlinkProcess = createHLSFetcherProcess(session.streamUrl);

        // Build FFmpeg args to read MPEG-TS from stdin
        ffmpegArgs = [
          '-hide_banner',
          '-loglevel', 'error',
          '-f', 'mpegts', // Raw MPEG-TS input
          '-i', 'pipe:0', // Read from stdin
        ];
      } else {
        // Build FFmpeg args - handle separate audio stream for YouTube
        ffmpegArgs = [
          '-hide_banner',
          '-loglevel', 'error',
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '5',
          '-protocol_whitelist', 'file,http,https,tcp,tls,crypto',
        ];
        
        // Add seek before input for better performance
        if (startTimeSec > 0) {
          ffmpegArgs.push('-ss', startTimeSec.toString());
        }
        
        ffmpegArgs.push('-i', session.streamUrl);
      }

      // Add separate audio input if provided (YouTube separates video/audio)
      if (session.audioUrl) {
        ffmpegArgs.push(
          '-reconnect', '1',
          '-reconnect_streamed', '1',
          '-reconnect_delay_max', '5',
        );
        
        // Add seek for audio too
        if (startTimeSec > 0) {
          ffmpegArgs.push('-ss', startTimeSec.toString());
        }
        
        ffmpegArgs.push('-i', session.audioUrl);
      }

      // Map video from first input, audio from second (or first if no separate audio)
      ffmpegArgs.push(
        '-map', '0:v:0?',
        '-map', session.audioUrl ? '1:a:0?' : '0:a:0?',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-pix_fmt', 'yuv420p',
        '-r', String(config.stream.frameRate),
        '-g', String(config.stream.frameRate), // Keyframe every 1 second (was 2)
        '-keyint_min', String(config.stream.frameRate), // Minimum keyframe interval
        '-b:v', `${config.stream.maxBitrate}k`,
        '-maxrate', `${config.stream.maxBitrate}k`, // Strict CBR (was 1.5x)
        '-bufsize', `${Math.floor(config.stream.maxBitrate / 2)}k`, // Smaller buffer for more consistent frames
        '-x264-params', 'nal-hrd=cbr:force-cfr=1', // Force constant bitrate and frame rate
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2`,
        '-c:a', 'libopus',
        '-b:a', '320k', // Reduced from 320k (Discord limit is 128k anyway)
        '-ar', '48000',
        '-ac', '2',
        '-af', `volume=${volumeMultiplier}`, // Removed speechnorm (CPU intensive)
        '-f', 'matroska',
        '-'
      );

      console.log('[VideoStreamer] Starting FFmpeg for external stream...');
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      session.ffmpegCommand = ffmpeg;

      // If using streamlink, pipe its output to FFmpeg
      if (streamlinkProcess) {
        if (streamlinkProcess.stdout) {
          streamlinkProcess.stdout.pipe(ffmpeg.stdin);
        }
        
        if (streamlinkProcess.stderr) {
          streamlinkProcess.stderr.on('data', (data: Buffer) => {
            const msg = data.toString().trim();
            if (msg) {
              console.log(msg); // Show all HLS fetcher output
            }
          });
        }
        
        streamlinkProcess.on('error', (err: Error) => {
          console.error('[VideoStreamer] Streamlink spawn error:', err.message);
        });
        
        streamlinkProcess.on('exit', (code: number | null) => {
          if (code !== 0 && code !== null) {
            console.log('[VideoStreamer] Streamlink exited with code:', code);
          }
        });
      }

      ffmpeg.stderr.on('data', (data) => {
        const msg = data.toString();
        // Always show errors, but only show other logs if enabled
        if (msg.includes('Error') || msg.includes('error') || msg.includes('Fatal')) {
          console.error('[FFmpeg]', msg);
        } else if (config.stream.showFFmpegLogs && !msg.includes('frame=') && !msg.includes('size=')) {
          console.error('[FFmpeg]', msg);
        }
      });

      ffmpeg.on('error', (err) => {
        console.error('[VideoStreamer] FFmpeg spawn error:', err.message);
      });

      ffmpeg.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.log('[VideoStreamer] FFmpeg exited with code:', code);
        }
      });

      console.log('[VideoStreamer] Starting Go Live stream (external)...');
      
      session.isPlaying = true;
      session.startedAt = Date.now();
      
      if (session.userId) {
        updateWatchDeck(session.mediaItem, 0, session.userId);
      }

      // Register stream for web viewing
      const { registerWebStream } = await import('../web/server.js');
      registerWebStream(session.guildId, session, session.streamUrl);

      await playStream(ffmpeg.stdout, this.streamer, {
        type: 'go-live',
      });

      console.log('[VideoStreamer] External playback finished');
      
      // Clean up streamlink process if it exists
      if (streamlinkProcess && !streamlinkProcess.killed) {
        streamlinkProcess.kill();
      }
      
      if (!session.isStopping) {
        this.sessions.delete(session.guildId);
        
        // Auto-play next item in queue
        await this.playNextInQueue(session.guildId, session.channelId, session.userId);
      }
    } catch (error) {
      if (!session.isStopping && error instanceof Error && !error.message.includes('abort')) {
        console.error('[VideoStreamer] External stream error:', error);
      }
      
      // Clean up streamlink process on error
      if (streamlinkProcess && !streamlinkProcess.killed) {
        streamlinkProcess.kill();
      }
      
      if (!session.isStopping) {
        this.sessions.delete(session.guildId);
      }
    }
  }

  private async playVideoStream(session: VideoStreamSession, startTimeMs = 0): Promise<void> {
    const startTimeSec = Math.floor(startTimeMs / 1000);
    
    const height = config.stream.defaultQuality;
    const width = Math.round(height * (16 / 9));

    try {
      // For Live TV channels, use the existing stream URL directly
      let freshStreamInfo;
      if (session.mediaItem.type === 'channel') {
        console.log('[VideoStreamer] Using Live TV channel URL directly');
        freshStreamInfo = { url: session.streamUrl };
      } else {
        // Always get a fresh stream URL to avoid stale session IDs
        console.log('[VideoStreamer] Getting fresh stream URL...');
        freshStreamInfo = await plexClient.getDirectStreamUrl(session.mediaItem.ratingKey);
        if (!freshStreamInfo) {
          throw new Error('Failed to get stream URL from Plex');
        }
      }
      
      // Update session with fresh URL and extract session ID
      session.streamUrl = freshStreamInfo.url;
      const urlObj = new URL(freshStreamInfo.url);
      session.sessionId = urlObj.searchParams.get('X-Plex-Session-Identifier') || 
                        urlObj.searchParams.get('session') || undefined;
      
      console.log('[VideoStreamer] Fresh Stream URL:', session.streamUrl.substring(0, 100) + '...');

      // Stop any existing transcode sessions first to avoid 400 errors
      console.log('[VideoStreamer] Stopping existing transcode sessions...');
      const stopped = await plexClient.stopTranscodeSession();
      
      // Wait a moment for Plex to clean up
      if (stopped) {
        console.log('[VideoStreamer] Waiting for cleanup to complete...');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Initialize Plex session by fetching the m3u8 first
      // This tells Plex to start the transcode session
      console.log('[VideoStreamer] Initializing Plex transcode session...');
      const initResponse = await fetch(session.streamUrl, {
        headers: {
          'Accept': '*/*',
          'X-Plex-Client-Identifier': config.plex.clientIdentifier,
          'X-Plex-Product': 'Plex Web',
          'X-Plex-Version': '4.0',
          'X-Plex-Platform': 'Chrome',
          'X-Plex-Device': 'Linux',
        }
      });
      
      if (!initResponse.ok) {
        throw new Error(`Failed to initialize Plex session: ${initResponse.status} ${initResponse.statusText}`);
      }
      
      const m3u8Content = await initResponse.text();
      console.log('[VideoStreamer] Session initialized, m3u8:', m3u8Content.substring(0, 200));
      
      // Extract the actual stream URL from m3u8 (it's relative)
      const lines = m3u8Content.split('\n');
      const streamPath = lines.find(l => l.endsWith('.m3u8') && !l.startsWith('#'));
      
      let actualStreamUrl = session.streamUrl;
      if (streamPath) {
        // Convert relative path to absolute URL
        const baseUrl = session.streamUrl.split('?')[0].replace('/start.m3u8', '');
        actualStreamUrl = `${config.plex.url}/video/:/transcode/universal/${streamPath}?X-Plex-Token=${config.plex.token}`;
        console.log('[VideoStreamer] Using stream URL:', actualStreamUrl.substring(0, 100) + '...');
      }

      // Build headers string for FFmpeg
      const headers = [
        'Accept: */*',
        'X-Plex-Client-Identifier: ' + config.plex.clientIdentifier,
        'X-Plex-Product: Plex Web',
        'X-Plex-Version: 4.0',
        'X-Plex-Platform: Chrome',
        'X-Plex-Device: Linux',
        'X-Plex-Token: ' + config.plex.token,
      ].join('\r\n') + '\r\n';

      const ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'error',
        // HTTP headers for Plex
        '-headers', headers,
        // HLS input options
        '-reconnect', '1',
        '-reconnect_streamed', '1', 
        '-reconnect_delay_max', '5',
        '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,hls',
      ];

      if (startTimeSec > 0) {
        ffmpegArgs.push('-ss', startTimeSec.toString());
      }

      // Calculate volume filter (100% = 1.0, 50% = 0.5, 200% = 2.0)
      const volumeMultiplier = (session.volume / 100).toFixed(2);

      const frameRate = config.stream.frameRate;
      const gopSize = frameRate * 2; // 2 seconds of keyframes
      
      ffmpegArgs.push(
        '-i', actualStreamUrl,
        // Video output - optimized for Discord streaming
        '-c:v', 'libx264',
        '-preset', 'ultrafast', // Fastest encoding for less CPU load
        '-tune', 'fastdecode', // Optimize for decoding speed
        '-profile:v', 'baseline', // Most compatible profile
        '-level', '4.0', // Ensure compatibility
        '-b:v', `${config.stream.maxBitrate}k`,
        '-maxrate', `${config.stream.maxBitrate}k`, // Same as bitrate to prevent spikes
        '-bufsize', `${config.stream.maxBitrate}k`, // Smaller buffer for less latency
        '-vf', `scale=${width}:${height}:flags=lanczos`,
        '-r', frameRate.toString(),
        '-g', '30', // Fixed GOP size for stability
        '-keyint_min', '30',
        '-sc_threshold', '0', // Disable scene change detection
        '-pix_fmt', 'yuv420p',
        '-x264-params', 'nal-hrd=cbr:force-cfr=1', // Constant framerate for stability
        // Audio output with volume filter
        '-af', `volume=${volumeMultiplier},speechnorm=e=6:r=0.001:l=1`,
        '-c:a', 'libopus',
        '-b:a', '320k',
        '-ar', '48000',
        '-ac', '2',
        // Output format
        '-f', 'matroska',
        'pipe:1'
      );

      console.log('[VideoStreamer] Starting FFmpeg with HLS input...');
      
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      session.ffmpegCommand = ffmpeg;

      ffmpeg.stderr.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg && !msg.includes('frame=')) {
          console.error('[FFmpeg]', msg);
        }
      });

      ffmpeg.on('error', (err) => {
        console.error('[VideoStreamer] FFmpeg spawn error:', err.message);
      });

      ffmpeg.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.log('[VideoStreamer] FFmpeg exited with code:', code);
        }
      });

      console.log('[VideoStreamer] Starting Go Live stream...');
      
      // Mark as actually playing now
      session.isPlaying = true;
      session.startedAt = Date.now(); // Reset start time to when stream actually begins
      
      // Update watch deck
      if (session.userId) {
        updateWatchDeck(session.mediaItem, startTimeMs, session.userId);
      }

      // Register stream for web viewing (web will do its own transcode)
      const { registerWebStream } = await import('../web/server.js');
      registerWebStream(session.guildId, session, actualStreamUrl);

      // Pass the FFmpeg stdout stream to playStream
      await playStream(ffmpeg.stdout, this.streamer, {
        type: 'go-live',
      });

      console.log('[VideoStreamer] Playback finished');
      // Only delete session if not intentionally stopped (pause/seek)
      if (!session.isStopping) {
        // Save position for resume later (only if actually played)
        if (session.isPlaying) {
          savePlaybackPosition(session.mediaItem.ratingKey, this.getCurrentTime(session.guildId));
        }
        this.sessions.delete(session.guildId);
        
        // Auto-play next item in queue
        await this.playNextInQueue(session.guildId, session.channelId, session.userId);
      }
    } catch (error) {
      // Only log error if not intentionally stopped
      if (!session.isStopping && error instanceof Error && !error.message.includes('abort')) {
        console.error('[VideoStreamer] Stream error:', error);
      }
      // Only delete session if not intentionally stopped
      if (!session.isStopping) {
        // Only save position if stream actually played
        if (session.isPlaying) {
          savePlaybackPosition(session.mediaItem.ratingKey, this.getCurrentTime(session.guildId));
        }
        this.sessions.delete(session.guildId);
      }
    }
  }

  async stopStream(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId);

    if (session) {
      // Get current position BEFORE stopping anything
      const currentPosition = session.isPlaying ? this.getCurrentTime(guildId) : 0;
      console.log(`[VideoStreamer] Stopping stream, position: ${currentPosition}ms, isPlaying: ${session.isPlaying}`);
      
      // Stop Plex transcode FIRST (before killing FFmpeg) - only for Plex streams
      if (!session.isExternal) {
        await plexClient.stopTranscodeSession(session.sessionId);
      }
      
      if (session.ffmpegCommand) {
        try {
          session.ffmpegCommand.kill('SIGKILL');
        } catch {
          // Ignore kill errors
        }
      }

      // Save position AFTER stopping (only if actually played)
      if (session.isPlaying && currentPosition > 0) {
        savePlaybackPosition(session.mediaItem.ratingKey, currentPosition);
      }

      // Unregister from web server
      const { unregisterWebStream } = await import('../web/server.js');
      unregisterWebStream(guildId);

      // Remove session
      this.sessions.delete(guildId);
      
      // Stop status update timer
      stopStatusUpdateTimer();
    }

    try {
      this.streamer.stopStream();
      this.streamer.leaveVoice();
    } catch {
      // Ignore disconnect errors
    }
  }

  async seekStream(guildId: string, timeMs: number): Promise<boolean> {
    const session = this.sessions.get(guildId);
    if (!session) return false;

    // Check if stream has already ended
    if (!session.isPlaying && !session.isPaused) {
      console.log('[VideoStreamer] Cannot seek - stream not active');
      return false;
    }

    // For external streams (YouTube, URLs), use FFmpeg -ss for seeking
    // But check if it's actually a local file first
    const isLocalFile = session.streamUrl.startsWith('/') || session.streamUrl.startsWith('./') || session.streamUrl.includes('downloads/');
    
    if (session.isExternal && !isLocalFile) {
      console.log(`[VideoStreamer] Seeking external stream to ${Math.floor(timeMs / 1000)}s`);
      session.currentTime = timeMs;
      session.startedAt = Date.now();
      session.isStopping = true;

      if (session.ffmpegCommand) {
        try {
          session.ffmpegCommand.kill('SIGTERM');
        } catch {
          // Ignore
        }
      }

      // Stop the current stream
      try {
        this.streamer.stopStream();
      } catch {
        // Ignore
      }

      // Wait for FFmpeg to stop
      await new Promise(resolve => setTimeout(resolve, 500));
      
      session.isStopping = false;
      await this.playExternalStream(session, timeMs);
      return true;
    }

    // For local files, use playLocalFile
    if (isLocalFile) {
      console.log(`[VideoStreamer] Seeking local file to ${Math.floor(timeMs / 1000)}s`);
      session.currentTime = timeMs;
      session.startedAt = Date.now();
      session.isStopping = true;

      if (session.ffmpegCommand) {
        try {
          session.ffmpegCommand.kill('SIGTERM');
        } catch {
          // Ignore
        }
      }

      // Stop the current stream
      try {
        this.streamer.stopStream();
      } catch {
        // Ignore
      }

      // Wait for FFmpeg to stop
      await new Promise(resolve => setTimeout(resolve, 500));
      
      session.isStopping = false;
      await this.playLocalFile(session, timeMs);
      return true;
    }

    // For Plex streams: Try HLS offset seeking first (no new session needed)
    // Note: This only works if we already have an active session URL (not start.m3u8)
    if (session.sessionId && timeMs > 0 && session.streamUrl.includes('/session/')) {
      console.log('[VideoStreamer] Using HLS offset seeking with existing session');
      
      // Use the existing session URL and add offset parameter
      const url = new URL(session.streamUrl);
      url.searchParams.set('offset', String(timeMs));
      
      session.currentTime = timeMs;
      session.startedAt = Date.now();
      session.isStopping = true;
      
      // Kill current FFmpeg
      if (session.ffmpegCommand) {
        try {
          session.ffmpegCommand.kill('SIGTERM');
        } catch {
          // Ignore
        }
      }
      
      // Stop Discord stream
      try {
        this.streamer.stopStream();
      } catch {
        // Ignore
      }
      
      // Wait for FFmpeg to stop
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Restart with the offset URL directly (don't call playVideoStream which would create new session)
      session.isStopping = false;
      
      // Build FFmpeg args directly with the offset URL
      const height = config.stream.defaultQuality;
      const width = Math.round(height * (16 / 9));
      const volumeMultiplier = (session.volume / 100).toFixed(2);
      const frameRate = config.stream.frameRate;
      const gopSize = frameRate * 2;
      
      const headers = [
        'Accept: */*',
        'X-Plex-Client-Identifier: ' + config.plex.clientIdentifier,
        'X-Plex-Product: Plex Web',
        'X-Plex-Version: 4.0',
        'X-Plex-Platform: Chrome',
        'X-Plex-Device: Linux',
        'X-Plex-Token: ' + config.plex.token,
      ].join('\r\n') + '\r\n';
      
      const ffmpegArgs = [
        '-hide_banner',
        '-loglevel', 'error',
        '-headers', headers,
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-protocol_whitelist', 'file,http,https,tcp,tls,crypto,hls',
        '-i', url.toString(),
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-b:v', `${config.stream.maxBitrate}k`,
        '-maxrate', `${Math.round(config.stream.maxBitrate * 1.5)}k`,
        '-bufsize', `${config.stream.maxBitrate * 2}k`,
        '-vf', `scale=${width}:${height}`,
        '-r', frameRate.toString(),
        '-g', gopSize.toString(),
        '-pix_fmt', 'yuv420p',
        '-af', `volume=${volumeMultiplier},speechnorm=e=6:r=0.001:l=1`,
        '-c:a', 'libopus',
        '-b:a', '320k',
        '-ar', '48000',
        '-ac', '2',
        '-f', 'matroska',
        'pipe:1'
      ];
      
      const ffmpeg = spawn('ffmpeg', ffmpegArgs);
      session.ffmpegCommand = ffmpeg;
      
      ffmpeg.stderr.on('data', (data: Buffer) => {
        const msg = data.toString().trim();
        if (msg && !msg.includes('frame=')) {
          console.error('[FFmpeg]', msg);
        }
      });
      
      ffmpeg.on('error', (err) => {
        console.error('[VideoStreamer] FFmpeg spawn error:', err.message);
      });
      
      ffmpeg.on('exit', (code) => {
        if (code !== 0 && code !== null) {
          console.log('[VideoStreamer] FFmpeg exited with code:', code);
        }
      });
      
      session.isPlaying = true;
      session.startedAt = Date.now();
      
      // Register for web viewing
      const { registerWebStream } = await import('../web/server.js');
      registerWebStream(session.guildId, session, url.toString());
      
      // Start streaming
      await playStream(ffmpeg.stdout, this.streamer, {
        type: 'go-live',
      });
      
      return true;
    }

    // Fallback: create new Plex session
    console.log('[VideoStreamer] Creating new Plex session for seek');
    session.currentTime = timeMs;
    session.startedAt = Date.now();
    session.isStopping = true;

    if (session.ffmpegCommand) {
      try {
        session.ffmpegCommand.kill('SIGTERM');
      } catch {
        // Ignore
      }
    }

    // Stop the current stream first
    try {
      this.streamer.stopStream();
    } catch {
      // Ignore
    }

    // Wait a bit for FFmpeg to fully stop
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    const freshStreamInfo = await plexClient.getDirectStreamUrl(session.mediaItem.ratingKey);
    if (freshStreamInfo) {
      session.streamUrl = freshStreamInfo.url;
      // Extract new session ID
      const urlObj = new URL(freshStreamInfo.url);
      session.sessionId = urlObj.searchParams.get('X-Plex-Session-Identifier') || 
                        urlObj.searchParams.get('session') || undefined;
    }
    
    session.isStopping = false;
    await this.playVideoStream(session, timeMs);
    return true;
  }

  async pauseStream(guildId: string): Promise<boolean> {
    const session = this.sessions.get(guildId);
    if (!session) return false;

    if (!session.isPaused) {
      session.currentTime = this.getCurrentTime(guildId);
      session.isPaused = true;
      session.isStopping = true; // Mark as intentional stop

      if (session.ffmpegCommand) {
        try {
          session.ffmpegCommand.kill('SIGTERM'); // Use SIGTERM instead of SIGKILL for graceful shutdown
        } catch {
          // Ignore
        }
      }

      this.streamer.stopStream();
      
      // Save position for later resume
      savePlaybackPosition(session.mediaItem.ratingKey, session.currentTime);
    }

    return true;
  }

  async resumeStream(guildId: string): Promise<boolean> {
    const session = this.sessions.get(guildId);
    if (!session || !session.isPaused) return false;

    // For Plex streams, get fresh stream URL (new Plex session)
    // For YouTube/external, reuse the same URL
    // For Live TV channels, reuse the same URL
    if (!session.isExternal && session.mediaItem.type !== 'channel') {
      const freshStreamInfo = await plexClient.getDirectStreamUrl(session.mediaItem.ratingKey);
      if (freshStreamInfo) {
        session.streamUrl = freshStreamInfo.url;
      }
    }

    session.isPaused = false;
    session.isStopping = false;
    session.startedAt = Date.now();

    // Check if this is a local file
    const isLocalFile = session.streamUrl.startsWith('/') || session.streamUrl.startsWith('./') || session.streamUrl.includes('downloads/');

    // Resume from saved position
    if (isLocalFile) {
      await this.playLocalFile(session, session.currentTime);
    } else if (session.isExternal) {
      await this.playExternalStream(session, session.currentTime);
    } else {
      await this.playVideoStream(session, session.currentTime);
    }
    
    return true;
  }

  getCurrentTime(guildId: string): number {
    const session = this.sessions.get(guildId);
    if (!session) return 0;

    if (session.isPaused) {
      return session.currentTime;
    }

    const elapsed = Date.now() - session.startedAt;
    return session.currentTime + elapsed;
  }

  getProgress(guildId: string): { current: number; total: number; percentage: number } {
    const session = this.sessions.get(guildId);
    if (!session) {
      return { current: 0, total: 0, percentage: 0 };
    }

    const current = this.getCurrentTime(guildId);
    const total = session.duration;
    const percentage = total > 0 ? (current / total) * 100 : 0;

    return { current, total, percentage };
  }

  getAllSessions(): string[] {
    return [...this.sessions.keys()];
  }

  async setVolume(guildId: string, volume: number): Promise<boolean> {
    const session = this.sessions.get(guildId);
    if (!session) return false;

    const oldVolume = session.volume;
    session.volume = Math.max(0, Math.min(200, volume));
    
    // If currently playing (not paused), restart stream at current position with new volume
    if (!session.isPaused && session.ffmpegCommand) {
      const currentTime = this.getCurrentTime(guildId);
      console.log(`[VideoStreamer] Volume changing from ${oldVolume}% to ${session.volume}%, restarting at ${Math.floor(currentTime / 1000)}s...`);
      
      session.currentTime = currentTime;
      session.isStopping = true;
      
      try {
        session.ffmpegCommand.kill('SIGKILL');
      } catch {
        // Ignore
      }
      
      // Wait for FFmpeg to stop
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Get fresh stream URL (new Plex session) - but not for Live TV channels
      if (session.mediaItem.type !== 'channel') {
        const freshStreamInfo = await plexClient.getDirectStreamUrl(session.mediaItem.ratingKey);
        if (freshStreamInfo) {
          session.streamUrl = freshStreamInfo.url;
        }
      }
      
      session.isStopping = false;
      session.startedAt = Date.now();
      await this.playVideoStream(session, currentTime);
    } else {
      console.log(`[VideoStreamer] Volume set to ${session.volume}% (will apply on resume)`);
    }
    
    return true;
  }
}

let videoStreamerInstance: VideoStreamer | null = null;

export function initVideoStreamer(client: Client): VideoStreamer {
  videoStreamerInstance = new VideoStreamer(client);
  return videoStreamerInstance;
}

export function getVideoStreamer(): VideoStreamer {
  if (!videoStreamerInstance) {
    throw new Error('VideoStreamer not initialized. Call initVideoStreamer first.');
  }
  return videoStreamerInstance;
}

export function leaveAllVoiceChannels(): void {
  if (videoStreamerInstance) {
    try {
      videoStreamerInstance.streamer.stopStream();
      videoStreamerInstance.streamer.leaveVoice();
      console.log('[VideoStreamer] Left all voice channels');
    } catch {
      // Ignore errors
    }
  }
}

export default VideoStreamer;
