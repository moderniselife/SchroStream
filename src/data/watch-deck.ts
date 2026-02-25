import type { MediaItem } from '../types/index.js';
import { saveWatchDeck, loadWatchDeck, saveWatchedVideos, loadWatchedVideos } from './storage.js';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';

export interface WatchDeckEntry {
  ratingKey: string;
  title: string;
  type: 'movie' | 'show' | 'season' | 'episode' | 'channel' | 'youtube' | 'external' | 'music';
  showTitle?: string;
  seasonNum?: number;
  episodeNum?: number;
  duration?: number;
  addedAt: number;
  // YouTube specific
  uploader?: string;
  url?: string;
  filePath?: string;
  // External stream specific
  streamType?: string;
  watchedAt?: number;
  fullyWatched?: boolean;
}

// Load watch deck from disk on startup
let watchDeck: WatchDeckEntry[] = loadWatchDeck() || [];

export function updateWatchDeck(mediaItem: MediaItem, position?: number, userId?: string): void {
  // Ensure watchDeck is an array
  if (!Array.isArray(watchDeck)) {
    watchDeck = [];
  }
  
  watchDeck = watchDeck.filter(entry => entry.ratingKey !== mediaItem.ratingKey);
  
  const entry: WatchDeckEntry = {
    ratingKey: mediaItem.ratingKey,
    title: mediaItem.title,
    type: mediaItem.type,
    showTitle: mediaItem.type === 'episode' ? mediaItem.grandparentTitle : undefined,
    seasonNum: mediaItem.type === 'episode' ? mediaItem.parentIndex : undefined,
    episodeNum: mediaItem.type === 'episode' ? mediaItem.index : undefined,
    duration: mediaItem.duration,
    addedAt: Date.now()
  };

  // Add YouTube-specific fields
  if (mediaItem.type === 'youtube') {
    const ytItem = mediaItem as any;
    entry.uploader = ytItem.uploader;
    entry.url = ytItem.url;
    entry.filePath = ytItem.filePath;
  }

  // Add external stream-specific fields
  if (mediaItem.type === 'external') {
    const extItem = mediaItem as any;
    entry.url = extItem.url;
    entry.streamType = extItem.streamType;
  }

  watchDeck.unshift(entry);
  saveWatchDeck(watchDeck); // Save to disk
}

export function getWatchDeck(): WatchDeckEntry[] {
  // Ensure watchDeck is an array
  if (!Array.isArray(watchDeck)) {
    watchDeck = [];
  }
  return [...watchDeck];
}

export function markVideoAsFullyWatched(ratingKey: string): void {
  // Ensure watchDeck is an array
  if (!Array.isArray(watchDeck)) {
    watchDeck = [];
  }
  
  const entry = watchDeck.find(e => e.ratingKey === ratingKey);
  if (entry) {
    entry.fullyWatched = true;
    entry.watchedAt = Date.now();
    saveWatchDeck(watchDeck);
    console.log(`[WatchDeck] Marked video as fully watched: ${entry.title}`);
  }
}

export function isVideoFullyWatched(ratingKey: string): boolean {
  // Ensure watchDeck is an array
  if (!Array.isArray(watchDeck)) {
    watchDeck = [];
  }
  
  const entry = watchDeck.find(e => e.ratingKey === ratingKey);
  return entry?.fullyWatched || false;
}

export function formatDeckEntry(entry: WatchDeckEntry, index?: number): string {
  const prefix = index !== undefined ? `${index + 1}. ` : '';
  let title = entry.title;
  let typeInfo = `(${entry.type})`;
  
  if (entry.type === 'episode' && entry.showTitle) {
    const season = entry.seasonNum ? `S${String(entry.seasonNum).padStart(2, '0')}` : '';
    const episode = entry.episodeNum ? `E${String(entry.episodeNum).padStart(2, '0')}` : '';
    title = `${entry.showTitle} ${season}${episode} - ${entry.title}`;
  } else if (entry.type === 'youtube' && entry.uploader) {
    typeInfo = `(YouTube • ${entry.uploader})`;
  } else if (entry.type === 'external' && entry.streamType) {
    typeInfo = `(External • ${entry.streamType})`;
  }
  
  const watchedStatus = entry.fullyWatched ? ' ✅' : '';
  
  return `${prefix}${title} ${typeInfo}${watchedStatus}`;
}

export function cleanupFullyWatchedVideos(): void {
  const downloadsDir = join(process.cwd(), 'downloads');
  
  // Ensure watchDeck is an array
  if (!Array.isArray(watchDeck)) {
    watchDeck = [];
  }
  
  // Get all fully watched videos
  const fullyWatched = watchDeck.filter(entry => entry.fullyWatched && entry.filePath);
  
  if (fullyWatched.length === 0) {
    console.log('[WatchDeck] No fully watched videos to clean up');
    return;
  }
  
  console.log(`[WatchDeck] Cleaning up ${fullyWatched.length} fully watched videos`);
  
  // Clean up each fully watched video
  for (const entry of fullyWatched) {
    if (entry.filePath && existsSync(entry.filePath)) {
      try {
        // Also delete the metadata file if it exists
        const metadataPath = entry.filePath.replace(/\.(mp4|webm|mkv|avi)$/, '.json');
        if (existsSync(metadataPath)) {
          unlinkSync(metadataPath);
        }
        
        unlinkSync(entry.filePath);
        console.log(`[WatchDeck] Deleted fully watched video: ${entry.title}`);
      } catch (error) {
        console.error(`[WatchDeck] Failed to delete video ${entry.title}:`, error);
      }
      
      // Remove from watch deck
      const index = watchDeck.findIndex(e => e.ratingKey === entry.ratingKey);
      if (index !== -1) {
        watchDeck.splice(index, 1);
      }
    }
  }
  
  // Save updated watch deck
  saveWatchDeck(watchDeck);
}
