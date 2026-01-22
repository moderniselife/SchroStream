import { Player } from 'yt-cast-receiver';
import { getVideoStreamer } from '../stream/video-streamer.js';
import { spawn } from 'child_process';
import config from '../config.js';

interface Video {
  id: string;
  title?: string;
  duration?: number;
  thumbnail?: string;
}

interface Volume {
  level: number;
  muted: boolean;
}

/**
 * SchroStream Player implementation for yt-cast-receiver
 * Bridges YouTube Cast commands to our video streamer
 */
export class SchroStreamPlayer extends Player {
  private currentVideo: Video | null = null;
  private currentPosition = 0;
  private currentDuration = 0;
  private volume: Volume = { level: 100, muted: false };
  private isPlaying = false;
  private positionUpdateInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    console.log('[CastPlayer] SchroStream Cast Player initialized');
  }

  /**
   * Play a video from the specified position
   */
  async doPlay(video: Video, position: number): Promise<boolean> {
    console.log(`[CastPlayer] doPlay called - video: ${video.id}, position: ${position}`);
    
    this.currentVideo = video;
    this.currentPosition = position;
    this.isPlaying = true;
    
    try {
      // Get stream URL using yt-dlp
      const streamUrl = await this.getYouTubeStreamUrl(video.id);
      if (!streamUrl) {
        console.error('[CastPlayer] Failed to get stream URL');
        return false;
      }
      
      console.log(`[CastPlayer] Got stream URL for ${video.id}`);
      
      // Get the video streamer
      const streamer = getVideoStreamer();
      
      // Create a media item for the streamer (using ExternalStreamItem type)
      const mediaItem = {
        ratingKey: video.id,
        key: `/youtube/${video.id}`,
        type: 'external' as const,
        title: video.title || `YouTube Video ${video.id}`,
        url: `https://www.youtube.com/watch?v=${video.id}`,
        duration: video.duration || 0,
        thumbnail: video.thumbnail || '',
      };
      
      // Ensure required config values exist
      const guildId = config.discord.webGuildId || '';
      const channelId = config.discord.webChannelId || '';
      const userId = config.discord.webUserId || '';
      
      if (!guildId || !channelId) {
        console.error('[CastPlayer] Missing guild or channel ID in config');
        return false;
      }
      
      // Start the stream
      await streamer.startExternalStream(
        guildId,
        channelId,
        mediaItem,
        streamUrl,
        userId
      );
      
      console.log(`[CastPlayer] ✓ Started playing: ${video.title || video.id}`);
      
      // Start position tracking
      this.startPositionTracking();
      
      return true;
    } catch (error) {
      console.error('[CastPlayer] Error playing video:', error);
      return false;
    }
  }

  /**
   * Pause current playback
   */
  async doPause(): Promise<boolean> {
    console.log('[CastPlayer] doPause called');
    this.isPlaying = false;
    this.stopPositionTracking();
    
    // Note: Our streamer doesn't support pause, so we just track the state
    // In a real implementation, you'd pause the actual playback
    return true;
  }

  /**
   * Resume paused playback
   */
  async doResume(): Promise<boolean> {
    console.log('[CastPlayer] doResume called');
    this.isPlaying = true;
    this.startPositionTracking();
    return true;
  }

  /**
   * Stop current playback
   */
  async doStop(): Promise<boolean> {
    console.log('[CastPlayer] doStop called');
    this.isPlaying = false;
    this.stopPositionTracking();
    
    try {
      const streamer = getVideoStreamer();
      const guildId = config.discord.webGuildId || '';
      if (guildId) {
        await streamer.stopStream(guildId);
        console.log('[CastPlayer] ✓ Stopped playback');
      }
      return true;
    } catch (error) {
      console.error('[CastPlayer] Error stopping:', error);
      return false;
    }
  }

  /**
   * Seek to a position
   */
  async doSeek(position: number): Promise<boolean> {
    console.log(`[CastPlayer] doSeek called - position: ${position}`);
    this.currentPosition = position;
    // Note: Our streamer doesn't support seeking
    return true;
  }

  /**
   * Set volume level and muted state
   */
  async doSetVolume(volume: Volume): Promise<boolean> {
    console.log(`[CastPlayer] doSetVolume called - level: ${volume.level}, muted: ${volume.muted}`);
    this.volume = volume;
    return true;
  }

  /**
   * Get current volume
   */
  async doGetVolume(): Promise<Volume> {
    return this.volume;
  }

  /**
   * Get current playback position
   */
  async doGetPosition(): Promise<number> {
    return this.currentPosition;
  }

  /**
   * Get current video duration
   */
  async doGetDuration(): Promise<number> {
    return this.currentDuration;
  }

  /**
   * Get YouTube stream URL using yt-dlp
   */
  private getYouTubeStreamUrl(videoId: string): Promise<string | null> {
    return new Promise((resolve) => {
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      
      const ytdlp = spawn('yt-dlp', [
        '-f', 'best[height<=1080]',
        '-g',
        '--no-playlist',
        url
      ]);
      
      let stdout = '';
      let stderr = '';
      
      ytdlp.stdout.on('data', (data) => {
        stdout += data.toString();
      });
      
      ytdlp.stderr.on('data', (data) => {
        stderr += data.toString();
      });
      
      ytdlp.on('close', (code) => {
        if (code === 0 && stdout.trim()) {
          resolve(stdout.trim().split('\n')[0]);
        } else {
          console.error('[CastPlayer] yt-dlp error:', stderr);
          resolve(null);
        }
      });
      
      ytdlp.on('error', (err) => {
        console.error('[CastPlayer] yt-dlp spawn error:', err);
        resolve(null);
      });
    });
  }

  /**
   * Start tracking playback position
   */
  private startPositionTracking(): void {
    this.stopPositionTracking();
    this.positionUpdateInterval = setInterval(() => {
      if (this.isPlaying) {
        this.currentPosition += 1;
      }
    }, 1000);
  }

  /**
   * Stop tracking playback position
   */
  private stopPositionTracking(): void {
    if (this.positionUpdateInterval) {
      clearInterval(this.positionUpdateInterval);
      this.positionUpdateInterval = null;
    }
  }
}
