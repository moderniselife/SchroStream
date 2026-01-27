import { spawn } from 'child_process';
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import config from '../config';

// Build common yt-dlp args for authentication
function getYtDlpAuthArgs(): string[] {
  const args: string[] = [];
  
  // Add cookies if configured (required for YT Premium high bitrate streams)
  if (config.youtube?.cookiesPath && existsSync(config.youtube.cookiesPath)) {
    args.push('--cookies', config.youtube.cookiesPath);
    console.log('[YouTubeDownloader] Using cookies for YouTube Premium access');
  }
  
  return args;
}

// Get format string based on quality preference
// YouTube Premium unlocks higher bitrate streams at all resolutions
// We prefer high bitrate even if it means downloading 4K/1440p and downscaling
function getFormatString(): string {
  if (config.youtube?.preferHighBitrate) {
    // Prefer best quality by bitrate, not resolution
    // This will grab 4K/1440p with high bitrate, we downscale in FFmpeg anyway
    // Sort by bitrate (tbr) descending, then height
    return 'bestvideo[vcodec^=avc1]+bestaudio/bestvideo+bestaudio/best';
  }
  // Fallback to resolution-limited
  return 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best';
}

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
  sponsorBlockSkipped?: number;
  sponsorBlockSegments?: number;
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
    
    const authArgs = getYtDlpAuthArgs();
    const formatString = getFormatString();
    
    console.log(`[YouTubeDownloader] Format selection: ${formatString}`);
    
    const ytdlpArgs = [
      ...authArgs,
      '--newline', // Show progress line by line
      '--progress', // Show progress
      '--no-playlist',
      '--no-warnings',
      '--embed-thumbnail', // Embed thumbnail in video
      '--embed-metadata', // Embed metadata
      '--merge-output-format', 'mp4', // Ensure MP4 output
      '--format', formatString, // Quality selection (prefers high bitrate with Premium)
      // SponsorBlock integration - remove sponsor segments during download
      '--sponsorblock-remove', 'sponsor,selfpromo,interaction,intro,outro,preview,filler',
      '--output', outputPath,
      '--exec', 'echo "DOWNLOAD_COMPLETE"', // Execute command when download completes
      url
    ];
    
    const ytdlp = spawn('yt-dlp', ytdlpArgs);

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
        
        // Fetch SponsorBlock segments for logging
        const { fetchSponsorSegments, formatSponsorBlockEmbed } = await import('./sponsorblock.js');
        const sponsorResult = await fetchSponsorSegments(url);
        
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
          sponsorBlockSkipped: sponsorResult?.totalSkipTime || 0,
          sponsorBlockSegments: sponsorResult?.segments.length || 0,
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
    const authArgs = getYtDlpAuthArgs();
    
    const ytdlp = spawn('yt-dlp', [
      ...authArgs,
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

// Check if a YouTube video is already downloaded by URL
export function findDownloadedVideoByUrl(url: string): DownloadedVideo | null {
  try {
    const files = readdirSync(DOWNLOADS_DIR);
    const videoFiles = files.filter(file => 
      file.endsWith('.mp4') || 
      file.endsWith('.webm') || 
      file.endsWith('.mkv') || 
      file.endsWith('.avi')
    );

    for (const file of videoFiles) {
      const filePath = join(DOWNLOADS_DIR, file);
      const metadata = getVideoMetadata(filePath);
      
      if (metadata && metadata.url === url) {
        // Video found, return the downloaded video info
        return {
          filePath,
          title: metadata.title,
          duration: metadata.duration,
          thumbnail: metadata.thumbnail,
          uploader: metadata.uploader,
          viewCount: metadata.viewCount,
          uploadDate: metadata.uploadDate,
          description: metadata.description,
        };
      }
    }
    
    return null; // Not found
  } catch (error) {
    console.error('[YouTubeDownloader] Error checking for downloaded video:', error);
    return null;
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
