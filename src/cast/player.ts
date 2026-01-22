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
      
      // Send notification to text channel
      await this.sendTextChannelNotification(guildId, video, youtubeUrl);
      
      // Get video info first
      console.log(`[CastPlayer] Getting video info for ${video.id}...`);
      const videoInfo = await getYouTubeInfo(youtubeUrl);
      const videoTitle = videoInfo?.title || video.title || `YouTube Video ${video.id}`;
      const videoDuration = videoInfo?.duration || video.duration || 0;
      this.currentDuration = videoDuration;
      
      // Download the video using existing downloader
      console.log(`[CastPlayer] Downloading video: ${videoTitle}`);
      const downloaded = await downloadYouTubeVideo(youtubeUrl, {
        onProgress: (progress) => {
          if (progress.percent % 20 < 1) {
            console.log(`[CastPlayer] Download: ${progress.percent.toFixed(0)}%`);
          }
        }
      });
      
      if (!downloaded) {
        console.error('[CastPlayer] Failed to download video');
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
      
      // Start position tracking
      this.startPositionTracking();
      
      return true;
    } catch (error) {
      console.error('[CastPlayer] Error playing video:', error);
      return false;
    }
  }
  
  /**
   * Send notification to text channel about Cast playback
   */
  private async sendTextChannelNotification(guildId: string, video: Video, url: string): Promise<void> {
    try {
      const guild = selfbotClient.guilds.cache.get(guildId);
      if (!guild) return;
      
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
      
      if (textChannel) {
        await textChannel.send({
          content: `📺 **YouTube Cast** - Now playing via Cast:\n${url}`,
        });
        console.log(`[CastPlayer] Sent notification to #${textChannel.name}`);
      }
    } catch (error) {
      console.error('[CastPlayer] Failed to send text channel notification:', error);
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
