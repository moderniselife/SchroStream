import { Streamer, prepareStream, playStream, Utils } from '@dank074/discord-video-stream';
import { Client } from 'discord.js-selfbot-v13';
import { spawn } from 'child_process';
import type { PlexMediaItem } from '../types/index.js';
import config from '../config.js';

export interface VideoStreamSession {
  guildId: string;
  channelId: string;
  mediaItem: PlexMediaItem;
  streamUrl: string;
  isPaused: boolean;
  startedAt: number;
  currentTime: number;
  duration: number;
  ffmpegCommand: any | null;
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
      startedAt: Date.now(),
      currentTime: startTimeMs,
      duration: mediaItem.duration || 0,
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
        '-r', '30',
        '-g', '60',
        '-pix_fmt', 'yuv420p',
        // Audio output
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

      // Pass the FFmpeg stdout stream to playStream
      await playStream(ffmpeg.stdout, this.streamer, {
        type: 'go-live',
      });

      console.log('[VideoStreamer] Playback finished');
      this.sessions.delete(session.guildId);
    } catch (error) {
      if (error instanceof Error && !error.message.includes('abort')) {
        console.error('[VideoStreamer] Stream error:', error);
      }
      this.sessions.delete(session.guildId);
    }
  }

  async stopStream(guildId: string): Promise<void> {
    const session = this.sessions.get(guildId);

    if (session) {
      if (session.ffmpegCommand) {
        try {
          session.ffmpegCommand.kill('SIGKILL');
        } catch {
          // Ignore kill errors
        }
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

    if (session.ffmpegCommand) {
      try {
        session.ffmpegCommand.kill('SIGKILL');
      } catch {
        // Ignore
      }
    }

    await this.playVideoStream(session, timeMs);
    return true;
  }

  async pauseStream(guildId: string): Promise<boolean> {
    const session = this.sessions.get(guildId);
    if (!session) return false;

    if (!session.isPaused) {
      session.currentTime = this.getCurrentTime(guildId);
      session.isPaused = true;

      if (session.ffmpegCommand) {
        try {
          session.ffmpegCommand.kill('SIGKILL');
        } catch {
          // Ignore
        }
      }

      this.streamer.stopStream();
    }

    return true;
  }

  async resumeStream(guildId: string): Promise<boolean> {
    const session = this.sessions.get(guildId);
    if (!session || !session.isPaused) return false;

    session.isPaused = false;
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
