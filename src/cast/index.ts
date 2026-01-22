import { Express } from 'express';
import { SSDPServer } from './ssdp.js';
import { DIALServer } from './dial.js';
import type { YouTubePlayRequest } from './dial.js';
import { getVideoStreamer } from '../stream/video-streamer.js';
import { spawn } from 'child_process';
import config from '../config.js';

export interface CastConfig {
  enabled: boolean;
  deviceName: string;
  friendlyName: string;
}

let ssdpServer: SSDPServer | null = null;
let dialServer: DIALServer | null = null;

/**
 * Generate a consistent UUID based on device name (persists across restarts)
 */
function generateDeviceUUID(deviceName: string): string {
  // Simple hash-based UUID generation for consistency
  let hash = 0;
  for (let i = 0; i < deviceName.length; i++) {
    const char = deviceName.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `${hex.slice(0, 8)}-${hex.slice(0, 4)}-4${hex.slice(1, 4)}-8${hex.slice(1, 4)}-${hex.padEnd(12, '0').slice(0, 12)}`;
}

/**
 * Get YouTube video info using yt-dlp
 */
async function getYouTubeVideoInfo(videoId: string): Promise<{
  title: string;
  duration: number;
  thumbnail?: string;
  uploader?: string;
} | null> {
  return new Promise((resolve) => {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const ytdlp = spawn('yt-dlp', [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      url
    ]);

    let output = '';
    let error = '';

    ytdlp.stdout.on('data', (data) => {
      output += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      error += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code !== 0 || !output) {
        console.error('[Cast] yt-dlp info error:', error);
        resolve(null);
        return;
      }

      try {
        const info = JSON.parse(output);
        resolve({
          title: info.title || 'YouTube Video',
          duration: (info.duration || 0) * 1000,
          thumbnail: info.thumbnail,
          uploader: info.uploader || info.channel,
        });
      } catch (e) {
        console.error('[Cast] Failed to parse yt-dlp output:', e);
        resolve(null);
      }
    });

    ytdlp.on('error', (err) => {
      console.error('[Cast] yt-dlp spawn error:', err);
      resolve(null);
    });
  });
}

/**
 * Get YouTube stream URLs using yt-dlp
 */
async function getYouTubeStreamUrls(videoId: string): Promise<{
  video: string;
  audio: string | null;
} | null> {
  return new Promise((resolve) => {
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    const ytdlp = spawn('yt-dlp', [
      '-g',
      '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
      '--no-playlist',
      '--no-warnings',
      url
    ]);

    let output = '';

    ytdlp.stdout.on('data', (data) => {
      output += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code !== 0 || !output) {
        resolve(null);
        return;
      }
      
      const lines = output.trim().split('\n');
      resolve({
        video: lines[0],
        audio: lines[1] || null
      });
    });

    ytdlp.on('error', () => {
      resolve(null);
    });
  });
}

/**
 * Handle YouTube cast play request
 */
async function handleYouTubePlay(request: YouTubePlayRequest): Promise<void> {
  console.log(`[Cast] Processing YouTube play request for video: ${request.videoId}`);
  
  // Check if we have the required web config
  if (!config.discord.webUserId || !config.discord.webGuildId || !config.discord.webChannelId) {
    console.error('[Cast] Cannot play - web control not configured (WEB_USER_ID, WEB_GUILD_ID, WEB_CHANNEL_ID required)');
    return;
  }
  
  // Get video info
  const info = await getYouTubeVideoInfo(request.videoId);
  if (!info) {
    console.error('[Cast] Failed to get video info for:', request.videoId);
    return;
  }
  
  console.log(`[Cast] Video info: ${info.title} (${Math.floor(info.duration / 1000)}s)`);
  
  // Get stream URLs
  const urls = await getYouTubeStreamUrls(request.videoId);
  if (!urls) {
    console.error('[Cast] Failed to get stream URLs for:', request.videoId);
    return;
  }
  
  console.log('[Cast] Got stream URLs, starting playback...');
  
  // Get the video streamer
  const streamer = getVideoStreamer();
  
  // Calculate start time in ms
  const startTimeMs = (request.currentTime || 0) * 1000;
  
  // Start the external stream
  try {
    await streamer.startExternalStream(
      config.discord.webGuildId,
      config.discord.webChannelId,
      {
        title: info.title,
        ratingKey: request.videoId,
        key: `/library/metadata/${request.videoId}`,
        type: 'youtube',
        duration: info.duration,
        thumb: info.thumbnail,
        url: `https://www.youtube.com/watch?v=${request.videoId}`,
      },
      urls.video,
      config.discord.webUserId,
      urls.audio
    );
    
    // Seek to start time if specified
    if (startTimeMs > 0) {
      setTimeout(async () => {
        try {
          await streamer.seekStream(config.discord.webGuildId!, startTimeMs);
          console.log(`[Cast] Seeked to ${Math.floor(startTimeMs / 1000)}s`);
        } catch (err) {
          console.error('[Cast] Failed to seek:', err);
        }
      }, 2000);
    }
    
    console.log(`[Cast] ✓ Started playing: ${info.title}`);
    
    // Update DIAL app state
    if (dialServer) {
      dialServer.setYouTubeState('running', request.videoId);
    }
  } catch (error) {
    console.error('[Cast] Failed to start stream:', error);
  }
}

/**
 * Handle YouTube cast stop request
 */
async function handleYouTubeStop(): Promise<void> {
  console.log('[Cast] Processing YouTube stop request');
  
  if (!config.discord.webGuildId) {
    console.error('[Cast] Cannot stop - web control not configured');
    return;
  }
  
  const streamer = getVideoStreamer();
  
  try {
    await streamer.stopStream(config.discord.webGuildId);
    console.log('[Cast] ✓ Stopped playback');
    
    // Update DIAL app state
    if (dialServer) {
      dialServer.setYouTubeState('stopped');
    }
  } catch (error) {
    console.error('[Cast] Failed to stop stream:', error);
  }
}

/**
 * Initialize the Cast receiver service
 */
export async function initCastReceiver(app: Express, port: number): Promise<void> {
  // Check if cast is enabled
  const castEnabled = process.env.CAST_ENABLED?.toLowerCase() === 'true';
  if (!castEnabled) {
    console.log('[Cast] Cast receiver disabled (set CAST_ENABLED=true to enable)');
    return;
  }
  
  const deviceName = process.env.CAST_DEVICE_NAME || 'SchroStream';
  const friendlyName = process.env.CAST_FRIENDLY_NAME || 'SchroStream (Bob)';
  
  console.log('[Cast] Initializing Cast receiver...');
  console.log(`[Cast] Device name: ${friendlyName}`);
  
  // Generate UUID
  const uuid = generateDeviceUUID(deviceName);
  console.log(`[Cast] Device UUID: ${uuid}`);
  
  // Create SSDP server for device discovery
  ssdpServer = new SSDPServer({
    deviceName,
    uuid,
    port,
    friendlyName,
  });
  
  // Create DIAL server for REST API
  dialServer = new DIALServer(
    {
      deviceName,
      uuid,
      friendlyName,
      manufacturer: 'SchroStream',
      modelName: 'Discord Media Streamer',
    },
    ssdpServer.getIP(),
    port
  );
  
  // Set up event handlers
  dialServer.on('youtube-play', handleYouTubePlay);
  dialServer.on('youtube-stop', handleYouTubeStop);
  dialServer.on('youtube-launch', () => {
    console.log('[Cast] YouTube app launched (no video)');
  });
  
  // Mount DIAL routes on the Express app
  app.use('/', dialServer.getRouter());
  
  // Start SSDP discovery
  try {
    await ssdpServer.start();
    console.log(`[Cast] ✓ Cast receiver ready`);
    console.log(`[Cast] ✓ Device discoverable as "${friendlyName}"`);
    console.log(`[Cast] ✓ Local IP: ${ssdpServer.getIP()}`);
  } catch (error) {
    console.error('[Cast] Failed to start SSDP server:', error);
    console.log('[Cast] Cast discovery may not work (SSDP port 1900 might be in use)');
  }
}

/**
 * Stop the Cast receiver service
 */
export function stopCastReceiver(): void {
  if (ssdpServer) {
    ssdpServer.stop();
    ssdpServer = null;
  }
  dialServer = null;
  console.log('[Cast] Cast receiver stopped');
}

export { DIALServer, SSDPServer, YouTubePlayRequest };
