import { spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, unlinkSync, statSync } from 'fs';
import { join } from 'path';
import { getYouTubeInfo, getYtdlpBaseArgs } from './downloader.js';

export interface MusicTrackInfo {
  id: string;
  title: string;
  artist: string;
  duration: number; // seconds
  url: string;
  thumbnailUrl?: string;
}

// Fetch all tracks from a YouTube playlist, album, or mix URL
export async function getPlaylistTracks(url: string): Promise<MusicTrackInfo[]> {
  return new Promise((resolve) => {
    const baseArgs = getYtdlpBaseArgs();
    const ytdlp = spawn('yt-dlp', [
      ...baseArgs,
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      '-I', '1:50', // cap at 50 tracks
      url,
    ]);

    let output = '';
    let error = '';

    ytdlp.stdout.on('data', (data) => { output += data.toString(); });
    ytdlp.stderr.on('data', (data) => { error += data.toString(); });

    ytdlp.on('close', (code) => {
      if (code !== 0 || !output.trim()) {
        console.error('[MusicDownloader] getPlaylistTracks failed:', error.trim());
        resolve([]);
        return;
      }

      const tracks: MusicTrackInfo[] = [];
      for (const line of output.trim().split('\n')) {
        if (!line.trim()) continue;
        try {
          const info = JSON.parse(line);
          if (!info.id) continue;
          tracks.push({
            id: info.id,
            title: info.title || info.id,
            artist: info.channel || info.uploader || info.uploader_id || 'Unknown Artist',
            duration: info.duration || 0,
            url: info.url || info.webpage_url || `https://www.youtube.com/watch?v=${info.id}`,
            thumbnailUrl: info.thumbnail || `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`,
          });
        } catch {
          // skip malformed lines
        }
      }

      console.log(`[MusicDownloader] Found ${tracks.length} tracks in playlist`);
      resolve(tracks);
    });

    ytdlp.on('error', (err) => {
      console.error('[MusicDownloader] getPlaylistTracks spawn error:', err);
      resolve([]);
    });
  });
}

// Fetch YouTube Mix recommendations based on a video ID (up to `limit` tracks)
export async function getMusicRecommendations(videoId: string, limit = 5): Promise<MusicTrackInfo[]> {
  // YouTube auto-generated mixes: RD{videoId}
  const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;
  return new Promise((resolve) => {
    const baseArgs = getYtdlpBaseArgs();
    const ytdlp = spawn('yt-dlp', [
      ...baseArgs,
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      '-I', `2:${limit + 1}`, // skip track 1 (the seed track itself)
      mixUrl,
    ]);

    let output = '';
    let error = '';

    ytdlp.stdout.on('data', (data) => { output += data.toString(); });
    ytdlp.stderr.on('data', (data) => { error += data.toString(); });

    ytdlp.on('close', (code) => {
      if (code !== 0 || !output.trim()) {
        console.error('[MusicDownloader] getMusicRecommendations failed:', error.trim());
        resolve([]);
        return;
      }

      const tracks: MusicTrackInfo[] = [];
      for (const line of output.trim().split('\n')) {
        if (!line.trim()) continue;
        try {
          const info = JSON.parse(line);
          if (!info.id) continue;
          tracks.push({
            id: info.id,
            title: info.title || info.id,
            artist: info.channel || info.uploader || info.uploader_id || 'Unknown Artist',
            duration: info.duration || 0,
            url: info.url || info.webpage_url || `https://www.youtube.com/watch?v=${info.id}`,
            thumbnailUrl: info.thumbnail || `https://i.ytimg.com/vi/${info.id}/hqdefault.jpg`,
          });
        } catch {
          // skip malformed lines
        }
      }

      console.log(`[MusicDownloader] Got ${tracks.length} recommendations for video ${videoId}`);
      resolve(tracks);
    });

    ytdlp.on('error', (err) => {
      console.error('[MusicDownloader] getMusicRecommendations spawn error:', err);
      resolve([]);
    });
  });
}

// Detect if a URL is a playlist or album (not a single track)
export function isPlaylistUrl(url: string): boolean {
  return url.includes('list=') || url.includes('/playlist') || url.includes('/album');
}

// Music downloads directory
const MUSIC_DIR = join(process.cwd(), 'downloads', 'music');
if (!existsSync(MUSIC_DIR)) {
  mkdirSync(MUSIC_DIR, { recursive: true });
}

export interface DownloadedMusic {
  audioPath: string;
  thumbnailPath: string;
  title: string;
  artist: string;
  duration: number; // ms
  thumbnailUrl?: string;
}

export interface MusicMetadata {
  title: string;
  artist: string;
  duration: number;
  thumbnailUrl?: string;
  url: string;
  downloadedAt: number;
}

export interface MusicDownloadProgress {
  percent: number;
  speed: string;
  eta: string;
}

export interface MusicDownloadOptions {
  onProgress?: (progress: MusicDownloadProgress) => void;
  onComplete?: () => void;
  onError?: (error: string) => void;
}

export async function downloadYouTubeMusic(url: string, options: MusicDownloadOptions = {}): Promise<DownloadedMusic | null> {
  // 1. Get video info for metadata
  const info = await getYouTubeInfo(url);
  if (!info) {
    if (options.onError) options.onError('Failed to get video info');
    return null;
  }

  const timestamp = Date.now();
  const audioBase = join(MUSIC_DIR, `music-${timestamp}`);
  const thumbnailPath = join(MUSIC_DIR, `thumb-${timestamp}.jpg`);

  // 2. Download thumbnail
  try {
    if (info.thumbnail) {
      const response = await fetch(info.thumbnail);
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        writeFileSync(thumbnailPath, buffer);
        console.log('[MusicDownloader] Thumbnail downloaded:', thumbnailPath);
      }
    }
  } catch (e) {
    console.error('[MusicDownloader] Failed to download thumbnail:', e);
  }

  // If no thumbnail was downloaded, create a placeholder
  if (!existsSync(thumbnailPath)) {
    // Create a simple dark gradient placeholder using FFmpeg
    try {
      const { execSync } = await import('child_process');
      execSync(`ffmpeg -f lavfi -i "color=c=#1a1a2e:s=800x800:d=1" -frames:v 1 -y "${thumbnailPath}" 2>/dev/null`);
      console.log('[MusicDownloader] Created placeholder thumbnail');
    } catch {
      console.warn('[MusicDownloader] Could not create placeholder thumbnail');
    }
  }

  // 3. Download audio only
  return new Promise((resolve) => {
    console.log('[MusicDownloader] Starting audio download for:', url);

    const baseArgs = getYtdlpBaseArgs();
    const ytdlp = spawn('yt-dlp', [
      ...baseArgs,
      '--newline',
      '--progress',
      '--no-playlist',
      '--no-warnings',
      '-f', 'bestaudio',
      '--extract-audio',
      '--audio-format', 'opus',
      '--embed-metadata',
      '--output', `${audioBase}.%(ext)s`,
      url
    ]);

    let completionTriggered = false;

    ytdlp.stdout.on('data', (data) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.includes('%')) {
          const progressMatch = line.match(/(\d+\.?\d*)%\s+of\s+\S+\s+at\s+(\S+)\s+ETA\s+(\S+)/);
          if (progressMatch && options.onProgress) {
            options.onProgress({
              percent: parseFloat(progressMatch[1]),
              speed: progressMatch[2],
              eta: progressMatch[3]
            });
          }
        }
      }
    });

    ytdlp.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        console.error('[MusicDownloader]', msg);
      }
    });

    ytdlp.on('close', (code) => {
      if (code !== 0) {
        console.error('[MusicDownloader] yt-dlp failed with code:', code);
        if (options.onError) options.onError(`Download failed with code ${code}`);
        resolve(null);
        return;
      }

      // Find the downloaded audio file (yt-dlp adds the extension)
      const audioPath = findAudioFile(audioBase);
      if (!audioPath) {
        console.error('[MusicDownloader] Audio file not found after download');
        if (options.onError) options.onError('Audio file not found after download');
        resolve(null);
        return;
      }

      console.log('[MusicDownloader] Audio downloaded:', audioPath);

      // Save metadata
      const metadata: MusicMetadata = {
        title: info.title,
        artist: info.uploader || 'Unknown Artist',
        duration: info.duration,
        thumbnailUrl: info.thumbnail,
        url,
        downloadedAt: Date.now(),
      };

      const metadataPath = audioPath.replace(/\.[^.]+$/, '.json');
      try {
        writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      } catch (e) {
        console.error('[MusicDownloader] Failed to save metadata:', e);
      }

      if (!completionTriggered) {
        completionTriggered = true;
        if (options.onComplete) options.onComplete();
      }

      resolve({
        audioPath,
        thumbnailPath: existsSync(thumbnailPath) ? thumbnailPath : '',
        title: info.title,
        artist: info.uploader || 'Unknown Artist',
        duration: info.duration,
        thumbnailUrl: info.thumbnail,
      });
    });

    ytdlp.on('error', (err) => {
      console.error('[MusicDownloader] yt-dlp spawn error:', err);
      if (options.onError) options.onError(`Spawn error: ${err.message}`);
      resolve(null);
    });
  });
}

// Find the audio file produced by yt-dlp (could be .opus, .m4a, .webm, etc.)
function findAudioFile(basePath: string): string | null {
  const extensions = ['.opus', '.m4a', '.webm', '.ogg', '.mp3', '.aac', '.flac', '.wav'];
  for (const ext of extensions) {
    const path = basePath + ext;
    if (existsSync(path)) return path;
  }

  // Fallback: look in directory for files matching the timestamp
  const dir = join(basePath, '..');
  const base = basePath.split('/').pop() || '';
  try {
    const files = readdirSync(dir);
    for (const file of files) {
      if (file.startsWith(base) && !file.endsWith('.json') && !file.endsWith('.jpg')) {
        return join(dir, file);
      }
    }
  } catch {
    // ignore
  }

  return null;
}

// Check if music is already downloaded by URL
export function findDownloadedMusicByUrl(url: string): DownloadedMusic | null {
  try {
    const files = readdirSync(MUSIC_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json') && f.startsWith('music-'));

    for (const jsonFile of jsonFiles) {
      try {
        const metadataPath = join(MUSIC_DIR, jsonFile);
        const metadata: MusicMetadata = JSON.parse(readFileSync(metadataPath, 'utf8'));

        if (metadata.url === url) {
          // Find the corresponding audio file
          const baseName = jsonFile.replace('.json', '');
          const audioFile = files.find(f => f.startsWith(baseName) && !f.endsWith('.json') && !f.endsWith('.jpg'));
          const thumbFile = jsonFile.replace(/^music-/, 'thumb-').replace('.json', '.jpg');

          if (audioFile) {
            return {
              audioPath: join(MUSIC_DIR, audioFile),
              thumbnailPath: existsSync(join(MUSIC_DIR, thumbFile)) ? join(MUSIC_DIR, thumbFile) : '',
              title: metadata.title,
              artist: metadata.artist,
              duration: metadata.duration,
              thumbnailUrl: metadata.thumbnailUrl,
            };
          }
        }
      } catch {
        // Skip malformed metadata
      }
    }

    return null;
  } catch (error) {
    console.error('[MusicDownloader] Error checking for downloaded music:', error);
    return null;
  }
}

// Clean up old music files (older than 24 hours)
export function cleanupOldMusic(): void {
  try {
    const files = readdirSync(MUSIC_DIR);
    const now = Date.now();
    const maxAge = 24 * 60 * 60 * 1000;

    for (const file of files) {
      const filePath = join(MUSIC_DIR, file);
      const stats = statSync(filePath);

      if (now - stats.mtime.getTime() > maxAge) {
        unlinkSync(filePath);
        console.log(`[MusicDownloader] Cleaned up old file: ${file}`);
      }
    }
  } catch (error) {
    console.error('[MusicDownloader] Error during cleanup:', error);
  }
}

// Run cleanup every hour
setInterval(cleanupOldMusic, 60 * 60 * 1000);
cleanupOldMusic();
