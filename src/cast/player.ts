import { Player } from 'yt-cast-receiver';
import { getVideoStreamer } from '../stream/video-streamer.js';
import { downloadYouTubeVideo, getYouTubeInfo } from '../youtube/downloader.js';
import { client as selfbotClient } from '../bot/client.js';
import config from '../config.js';
import { TextChannel } from 'discord.js-selfbot-v13';

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
      const guildId = config.discord.webGuildId || '';
      const channelId = config.discord.webChannelId || '';
      const userId = config.discord.webUserId || '';
      
      if (!guildId || !channelId) {
        console.error('[CastPlayer] Missing guild or channel ID in config');
        return false;
      }
      
      const youtubeUrl = `https://www.youtube.com/watch?v=${video.id}`;
      
      // Get video info first
      console.log(`[CastPlayer] Getting video info for ${video.id}...`);
      const videoInfo = await getYouTubeInfo(youtubeUrl);
      const videoTitle = videoInfo?.title || video.title || `YouTube Video ${video.id}`;
      const videoDuration = videoInfo?.duration || video.duration || 0;
      this.currentDuration = videoDuration;
      
      // Get text channel for progress updates
      const textChannel = await this.getNotificationChannel(guildId);
      let progressMessage: any = null;
      
      // Send initial "Cast received" message
      if (textChannel) {
        progressMessage = await textChannel.send(
          `📺 **YouTube Cast Received**\n` +
          `🎬 **${videoTitle}**\n\n` +
          `📥 *Starting download...*`
        );
      }
      
      // Download the video using existing downloader with progress updates
      console.log(`[CastPlayer] Downloading video: ${videoTitle}`);
      let lastUpdateTime = 0;
      const UPDATE_COOLDOWN = 2000;
      
      const downloaded = await downloadYouTubeVideo(youtubeUrl, {
        onProgress: async (progress) => {
          const now = Date.now();
          if (now - lastUpdateTime < UPDATE_COOLDOWN) return;
          lastUpdateTime = now;
          
          console.log(`[CastPlayer] Download: ${progress.percent.toFixed(0)}%`);
          
          if (progressMessage) {
            const progressBar = this.createProgressBar(progress.percent);
            try {
              await progressMessage.edit(
                `📺 **YouTube Cast - Downloading**\n` +
                `🎬 **${videoTitle}**\n\n` +
                `${progressBar}\n` +
                `📊 ${progress.speed} | ⏱️ ETA: ${progress.eta}\n` +
                `📁 Total: ${progress.total}\n\n` +
                `*Will auto-start streaming when complete...*`
              );
            } catch (e) { /* ignore edit errors */ }
          }
        },
        onComplete: async () => {
          if (progressMessage) {
            try {
              await progressMessage.edit(
                `📺 **YouTube Cast - Download Complete!**\n` +
                `🎬 **${videoTitle}**\n\n` +
                `✅ Video downloaded successfully\n\n` +
                `🎬 *Starting stream automatically...*`
              );
            } catch (e) { /* ignore edit errors */ }
          }
        }
      });
      
      if (!downloaded) {
        console.error('[CastPlayer] Failed to download video');
        if (progressMessage) {
          await progressMessage.edit(`📺 **YouTube Cast - Failed**\n❌ Download failed`).catch(() => {});
        }
        return false;
      }
      
      console.log(`[CastPlayer] ✓ Downloaded: ${downloaded.filePath}`);
      
      // Get the video streamer
      const streamer = getVideoStreamer();
      
      // Create a media item for the streamer (same format as /yt command)
      const mediaItem = {
        ratingKey: `yt-${Date.now()}`,
        key: youtubeUrl,
        title: videoTitle,
        type: 'movie' as const,
        duration: videoDuration,
        thumb: downloaded.thumbnail || video.thumbnail || '',
      };
      
      // Start the stream from local file (same as /yt command)
      await streamer.startLocalFile(
        guildId,
        channelId,
        mediaItem,
        downloaded.filePath,
        userId,
        0 // Start position
      );
      
      console.log(`[CastPlayer] ✓ Started playing: ${videoTitle}`);
      
      // Update message to show now playing
      if (progressMessage) {
        const durationStr = videoDuration ? this.formatDuration(videoDuration) : 'Unknown';
        await progressMessage.edit(
          `📺 **YouTube Cast - Now Playing**\n` +
          `🎬 **${videoTitle}**\n\n` +
          `⏱️ Duration: ${durationStr}\n` +
          `📺 Channel: ${downloaded.uploader || 'Unknown'}\n` +
          `📥 Source: Local file (no buffering!)`
        ).catch(() => {});
      }
      
      // Start position tracking
      this.startPositionTracking();
      
      return true;
    } catch (error) {
      console.error('[CastPlayer] Error playing video:', error);
      return false;
    }
  }
  
  /**
   * Create a progress bar string
   */
  private createProgressBar(percent: number): string {
    const barLength = 20;
    const filledLength = Math.round((percent / 100) * barLength);
    const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
    return `[${bar}] ${percent.toFixed(1)}%`;
  }
  
  /**
   * Format duration in seconds to MM:SS or HH:MM:SS
   */
  private formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
  
  /**
   * Get the notification channel for Cast messages
   */
  private async getNotificationChannel(guildId: string): Promise<TextChannel | null> {
    try {
      const guild = selfbotClient.guilds.cache.get(guildId);
      if (!guild) return null;
      
      let textChannel: TextChannel | undefined;
      
      // Check for configured notification channel
      const notificationChannelId = process.env.CAST_NOTIFICATION_CHANNEL_ID;
      if (notificationChannelId) {
        textChannel = guild.channels.cache.get(notificationChannelId) as TextChannel | undefined;
      }
      
      // Fallback to first available text channel
      if (!textChannel) {
        textChannel = guild.channels.cache.find(
          (ch) => ch.type === 'GUILD_TEXT' && ch.permissionsFor(selfbotClient.user!)?.has('SEND_MESSAGES')
        ) as TextChannel | undefined;
      }
      
      return textChannel || null;
    } catch (error) {
      console.error('[CastPlayer] Failed to get notification channel:', error);
      return null;
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
