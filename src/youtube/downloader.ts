import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import config from '../config';

export interface DownloadedVideo {
  filePath: string;
  title: string;
  duration: number;
  thumbnail?: string;
  uploader?: string;
  viewCount?: string;
  uploadDate?: string;
  description?: string;
}

export interface VideoMetadata {
  title: string;
  duration: number;
  thumbnail?: string;
  uploader?: string;
  viewCount?: string;
  uploadDate?: string;
  description?: string;
  url: string;
  downloadedAt: number;
  videoID?: string;
  sponsorSegments?: any[]; // SponsorBlock segments
  sponsorBlockEnabled?: boolean; // Whether segments were applied
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
    let completionTriggered = false;
    let reached100Percent = false;

    const triggerCompletion = () => {
      if (!completionTriggered && reached100Percent) {
        completionTriggered = true;
        console.log('[YouTubeDownloader] Both 100% and DOWNLOAD_COMPLETE detected, triggering completion');
        if (options.onComplete) {
          options.onComplete();
        }
      }
    };

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

            // Trigger completion when reaching 100%
            if (progress.percent >= 100.0 && !reached100Percent) {
              console.log('[YouTubeDownloader] Download reached 100%, marking as complete');
              reached100Percent = true;
              setTimeout(triggerCompletion, 1000); // Wait a bit for DOWNLOAD_COMPLETE message
            }
          }
        } else if (line.includes('DOWNLOAD_COMPLETE')) {
          console.log('[YouTubeDownloader] Download completed successfully');
          triggerCompletion();
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

      // Trigger completion as a fallback if it hasn't been triggered yet
      if (!completionTriggered && reached100Percent) {
        console.log('[YouTubeDownloader] Triggering completion from close event (100% reached)');
        triggerCompletion();
      }

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

        // Save metadata file alongside video
        const metadataPath = outputPath.replace('.mp4', '.json');
        
        // Extract video ID from URL for SponsorBlock
        const videoIDMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/);
        const videoID = videoIDMatch ? videoIDMatch[1] : undefined;
        
        // Fetch SponsorBlock segments if video ID is available
        let sponsorSegments: any[] = [];
        if (videoID && config.sponsorBlock?.enabled !== false) {
          try {
            const { getSponsorSegments } = await import('./sponsorblock.js');
            sponsorSegments = await getSponsorSegments(videoID);
            console.log(`[YouTubeDownloader] Found ${sponsorSegments.length} SponsorBlock segments`);
          } catch (error) {
            console.error('[YouTubeDownloader] Failed to fetch SponsorBlock segments:', error);
          }
        }
        
        const metadata: VideoMetadata = {
          title: info.title,
          duration: info.duration,
          thumbnail: info.thumbnail,
          uploader: info.uploader,
          viewCount: info.view_count ? formatNumber(info.view_count) : undefined,
          uploadDate: info.upload_date ? new Date(info.upload_date).toLocaleDateString() : undefined,
          description: info.description ? (info.description.length > 100 ? info.description.substring(0, 100) + '...' : info.description) : undefined,
          url: url,
          downloadedAt: Date.now(),
          videoID: videoID,
          sponsorSegments: sponsorSegments,
          sponsorBlockEnabled: sponsorSegments.length > 0
        };

        try {
          writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
          console.log('[YouTubeDownloader] Saved metadata to:', metadataPath);
        } catch (metaError) {
          console.error('[YouTubeDownloader] Failed to save metadata:', metaError);
        }

        resolve({
          filePath: outputPath,
          title: info.title,
          duration: info.duration,
          thumbnail: info.thumbnail,
          uploader: info.uploader,
          viewCount: info.view_count ? formatNumber(info.view_count) : undefined,
          uploadDate: info.upload_date ? new Date(info.upload_date).toLocaleDateString() : undefined,
          description: info.description ? (info.description.length > 100 ? info.description.substring(0, 100) + '...' : info.description) : undefined,
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

async function getYouTubeInfo(url: string): Promise<{ title: string; duration: number; thumbnail?: string; uploader?: string; view_count?: number; upload_date?: string; description?: string } | null> {
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
          view_count: info.view_count,
          upload_date: info.upload_date,
          description: info.description,
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

export function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
  return num.toString();
}

export { getYouTubeInfo };

// Clean up old downloaded files (older than 24 hours)
export function cleanupOldDownloads(): void {
  try {
    const files = readdirSync(DOWNLOADS_DIR);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours

    for (const file of files) {
      const filePath = join(DOWNLOADS_DIR, file);
      const stats = statSync(filePath);
      
      if (now - stats.mtime.getTime() > maxAge) {
        unlinkSync(filePath);
        console.log(`[YouTubeDownloader] Cleaned up old file: ${file}`);
      }
    }
  } catch (error) {
    console.error('[YouTubeDownloader] Error during cleanup:', error);
  }
}

// Get metadata for a video file
export function getVideoMetadata(videoFile: string): VideoMetadata | null {
  try {
    const metadataPath = videoFile.replace(/\.(mp4|webm|mkv|avi)$/, '.json');
    if (!existsSync(metadataPath)) {
      return null;
    }
    
    const metadataContent = JSON.parse(readFileSync(metadataPath, 'utf8'));
    return metadataContent as VideoMetadata;
  } catch (error) {
    console.error('[YouTubeDownloader] Failed to read metadata:', error);
    return null;
  }
}

// Run cleanup every hour
setInterval(cleanupOldDownloads, 60 * 60 * 1000);

// Initial cleanup on startup
cleanupOldDownloads();
