import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import config from '../config.js';

export interface DownloadedVideo {
  filePath: string;
  title: string;
  duration: number;
  thumbnail?: string;
  uploader?: string;
}

export interface DownloadProgress {
  percent: number;
  downloaded: string;
  total: string;
  speed: string;
  eta: string;
}

export interface DownloadOptions {
  onProgress?: (progress: DownloadProgress) => void;
  onComplete?: () => void;
  onError?: (error: string) => void;
}

// Create downloads directory if it doesn't exist
const DOWNLOADS_DIR = join(process.cwd(), 'downloads');
if (!existsSync(DOWNLOADS_DIR)) {
  mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

export async function downloadYouTubeVideo(url: string, options: DownloadOptions = {}): Promise<DownloadedVideo | null> {
  return new Promise((resolve) => {
    console.log('[YouTubeDownloader] Starting accelerated download for:', url);
    
    // Generate unique filename based on timestamp
    const timestamp = Date.now();
    const outputPath = join(DOWNLOADS_DIR, `video-${timestamp}.mp4`);
    
    const ytdlp = spawn('yt-dlp', [
      '--newline', // Show progress line by line
      '--progress', // Show progress
      '--no-playlist',
      '--no-warnings',
      '--embed-thumbnail', // Embed thumbnail in video
      '--embed-metadata', // Embed metadata
      '--merge-output-format', 'mp4', // Ensure MP4 output
      '--format', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best', // Quality selection
      '--output', outputPath,
      '--exec', 'echo "DOWNLOAD_COMPLETE"', // Execute command when download completes
      url
    ]);

    let output = '';
    let error = '';

    ytdlp.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.includes('%')) {
          // Parse progress: "Downloading  45.2% of 125.34MiB at 2.15MiB/s ETA 00:25"
          const progressMatch = line.match(/(\d+\.?\d*)%\s+of\s+(\d+\.?\d*\w+)\s+at\s+(\d+\.?\d*\w+\/s)\s+ETA\s+(\d+:\d+)/);
          if (progressMatch) {
            const progress: DownloadProgress = {
              percent: parseFloat(progressMatch[1]),
              downloaded: `${progressMatch[1]}%`,
              total: progressMatch[2],
              speed: progressMatch[3],
              eta: progressMatch[4]
            };
            
            console.log(`[YouTubeDownloader] Download progress: ${progress.percent.toFixed(1)}% (${progress.speed})`);
            
            // Emit progress event
            if (options.onProgress) {
              options.onProgress(progress);
            }
          }
        } else if (line.includes('DOWNLOAD_COMPLETE')) {
          console.log('[YouTubeDownloader] Download completed successfully');
          if (options.onComplete) {
            options.onComplete();
          }
        }
      }
      output += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      const errorMsg = data.toString();
      error += errorMsg;
      console.error('[YouTubeDownloader] yt-dlp error:', errorMsg.trim());
      
      // Emit error event
      if (options.onError) {
        options.onError(errorMsg.trim());
      }
    });

    ytdlp.on('close', async (code) => {
      if (code !== 0) {
        console.error('[YouTubeDownloader] yt-dlp failed with code:', code);
        console.error('[YouTubeDownloader] Error details:', error);
        
        if (options.onError) {
          options.onError(`Download failed with code ${code}`);
        }
        
        resolve(null);
        return;
      }

      // Check if file exists
      if (!existsSync(outputPath)) {
        console.error('[YouTubeDownloader] Downloaded file not found at:', outputPath);
        
        if (options.onError) {
          options.onError('Downloaded file not found');
        }
        
        resolve(null);
        return;
      }

      console.log('[YouTubeDownloader] Download completed:', outputPath);

      // Get video info for metadata
      try {
        const info = await getYouTubeInfo(url);
        if (!info) {
          console.error('[YouTubeDownloader] Failed to get video info after download');
          
          if (options.onError) {
            options.onError('Failed to get video info');
          }
          
          resolve(null);
          return;
        }

        resolve({
          filePath: outputPath,
          title: info.title,
          duration: info.duration,
          thumbnail: info.thumbnail,
          uploader: info.uploader,
        });
      } catch (e) {
        console.error('[YouTubeDownloader] Error getting video info:', e);
        
        if (options.onError) {
          options.onError('Error getting video info');
        }
        
        // Still return the downloaded file even if info fetch fails
        resolve({
          filePath: outputPath,
          title: 'Unknown',
          duration: 0,
        });
      }
    });

    ytdlp.on('error', (err) => {
      console.error('[YouTubeDownloader] yt-dlp spawn error:', err);
      
      if (options.onError) {
        options.onError(`Spawn error: ${err.message}`);
      }
      
      resolve(null);
    });
  });
}

async function getYouTubeInfo(url: string): Promise<{ title: string; duration: number; thumbnail?: string; uploader?: string } | null> {
  return new Promise((resolve) => {
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
        console.error('[YouTubeDownloader] yt-dlp info error:', error);
        resolve(null);
        return;
      }

      try {
        const info = JSON.parse(output);
        resolve({
          title: info.title || 'Unknown',
          duration: (info.duration || 0) * 1000,
          thumbnail: info.thumbnail,
          uploader: info.uploader || info.channel,
        });
      } catch (e) {
        console.error('[YouTubeDownloader] Failed to parse yt-dlp output:', e);
        resolve(null);
      }
    });

    ytdlp.on('error', (err) => {
      console.error('[YouTubeDownloader] yt-dlp info spawn error:', err);
      resolve(null);
    });
  });
}

// Clean up old downloaded files (older than 24 hours)
export function cleanupOldDownloads(): void {
  try {
    const fs = require('fs');
    const files = fs.readdirSync(DOWNLOADS_DIR);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const file of files) {
      const filePath = join(DOWNLOADS_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (now - stats.mtime.getTime() > maxAge) {
        fs.unlinkSync(filePath);
        console.log(`[YouTubeDownloader] Cleaned up old file: ${file}`);
      }
    }
  } catch (error) {
    console.error('[YouTubeDownloader] Error during cleanup:', error);
  }
}

// Run cleanup every hour
setInterval(cleanupOldDownloads, 60 * 60 * 1000);

// Initial cleanup on startup
cleanupOldDownloads();
