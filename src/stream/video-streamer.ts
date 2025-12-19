import { Streamer, prepareStream, playStream, Utils } from '@dank074/discord-video-stream';
import { Client } from 'discord.js-selfbot-v13';
import { spawn } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { PlexMediaItem } from '../types/index.js';
import config from '../config.js';
import plexClient from '../plex/client.js';

// Playback history file path
const HISTORY_FILE = join(process.cwd(), 'data', 'playback-history.json');

export interface VideoStreamSession {
  guildId: string;
  channelId: string;
  mediaItem: PlexMediaItem;
  streamUrl: string;
  isPaused: boolean;
  isStopping: boolean; // Flag to track intentional stop (pause/seek)
  isPlaying: boolean; // Flag to track if stream actually started playing
  startedAt: number;
  currentTime: number;
  duration: number;
  volume: number;
  ffmpegCommand: any | null;
}

// Store playback positions for resume functionality (ratingKey -> position in ms)
interface PlaybackHistoryEntry {
  position: number;
  updatedAt: number;
  title?: string;
}

let playbackHistory: Map<string, PlaybackHistoryEntry> = new Map();

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

  async startStream(
    guildId: string,
    channelId: string,
    mediaItem: PlexMediaItem,
    streamUrl: string,
    startTimeMs = 0
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
    };

    this.sessions.set(guildId, session);

    this.playVideoStream(session, startTimeMs);
  }

  private async playVideoStream(session: VideoStreamSession, startTimeMs = 0): Promise<void> {
    const startTimeSec = Math.floor(startTimeMs / 1000);
    
    const height = config.stream.defaultQuality;
    const width = Math.round(height * (16 / 9));

    try {
      console.log('[VideoStreamer] Stream URL:', session.streamUrl.substring(0, 100) + '...');

      // Stop any existing transcode sessions first to avoid 400 errors
      await plexClient.stopTranscodeSession();
      
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
        // Video output
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
        // Audio output with volume filter
        '-af', `volume=${volumeMultiplier}`,
        '-c:a', 'libopus',
        '-b:a', `${config.stream.audioBitrate}k`,
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
      
      // Stop Plex transcode FIRST (before killing FFmpeg)
      await plexClient.stopTranscodeSession();
      
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

      this.sessions.delete(guildId);
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

    session.currentTime = timeMs;
    session.startedAt = Date.now();
    session.isStopping = true; // Mark as intentional stop

    if (session.ffmpegCommand) {
      try {
        session.ffmpegCommand.kill('SIGKILL');
      } catch {
        // Ignore
      }
    }

    // Wait a bit for FFmpeg to fully stop
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Get fresh stream URL (new Plex session)
    const freshStreamInfo = await plexClient.getDirectStreamUrl(session.mediaItem.ratingKey);
    if (freshStreamInfo) {
      session.streamUrl = freshStreamInfo.url;
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
          session.ffmpegCommand.kill('SIGKILL');
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

    // Get fresh stream URL (new Plex session)
    const freshStreamInfo = await plexClient.getDirectStreamUrl(session.mediaItem.ratingKey);
    if (freshStreamInfo) {
      session.streamUrl = freshStreamInfo.url;
    }

    session.isPaused = false;
    session.isStopping = false;
    session.startedAt = Date.now();

    await this.playVideoStream(session, session.currentTime);
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
      
      // Get fresh stream URL (new Plex session)
      const freshStreamInfo = await plexClient.getDirectStreamUrl(session.mediaItem.ratingKey);
      if (freshStreamInfo) {
        session.streamUrl = freshStreamInfo.url;
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

export default VideoStreamer;
