import { Streamer, prepareStream, playStream, Utils } from '@dank074/discord-video-stream';
import { Client } from 'discord.js-selfbot-v13';
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

    try {
      const inputFlags: string[] = [];
      if (startTimeSec > 0) {
        inputFlags.push('-ss', startTimeSec.toString());
      }

      const { command, output } = prepareStream(session.streamUrl, {
        height,
        frameRate: 30,
        bitrateVideo: config.stream.maxBitrate,
        bitrateVideoMax: Math.round(config.stream.maxBitrate * 1.5),
        bitrateAudio: config.stream.audioBitrate,
        videoCodec: Utils.normalizeVideoCodec('H264'),
        h26xPreset: 'veryfast',
        includeAudio: true,
        customFfmpegFlags: inputFlags.length > 0 ? inputFlags : undefined,
      });

      session.ffmpegCommand = command;

      command.on('error', (err: Error) => {
        if (!err.message.includes('SIGKILL') && !err.message.includes('ffmpeg was killed')) {
          console.error('[VideoStreamer] FFmpeg error:', err.message);
        }
      });

      console.log('[VideoStreamer] Starting Go Live stream...');

      await playStream(output, this.streamer, {
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
