import type { MediaItem } from '../types/index.js';
import { saveQueue, loadQueue } from './storage.js';

export interface QueueEntry {
  id: string;
  ratingKey: string;
  title: string;
  type: 'movie' | 'show' | 'season' | 'episode' | 'channel' | 'youtube' | 'external' | 'music';
  showTitle?: string;
  seasonNum?: number;
  episodeNum?: number;
  duration?: number;
  addedAt: number;
  addedBy?: string;
  // YouTube specific
  uploader?: string;
  viewCount?: string;
  uploadDate?: string;
  url?: string;
  filePath?: string;
  // External stream specific
  streamType?: string;
}

// Load queue from disk on startup
let queue: QueueEntry[] = loadQueue();

export function addToQueue(mediaItem: MediaItem, addedBy?: string): boolean {
  const exists = queue.some(entry => entry.ratingKey === mediaItem.ratingKey);
  if (exists) return false;
  
  const entry: QueueEntry = {
    id: `${mediaItem.ratingKey}-${Date.now()}`,
    ratingKey: mediaItem.ratingKey,
    title: mediaItem.title,
    type: mediaItem.type,
    showTitle: mediaItem.type === 'episode' ? mediaItem.grandparentTitle : undefined,
    seasonNum: mediaItem.type === 'episode' ? mediaItem.parentIndex : undefined,
    episodeNum: mediaItem.type === 'episode' ? mediaItem.index : undefined,
    duration: mediaItem.duration,
    addedAt: Date.now(),
    addedBy
  };

  // Add YouTube-specific fields
  if (mediaItem.type === 'youtube') {
    const ytItem = mediaItem as any;
    entry.uploader = ytItem.uploader;
    entry.viewCount = ytItem.viewCount;
    entry.uploadDate = ytItem.uploadDate;
    entry.url = ytItem.url;
    entry.filePath = ytItem.filePath;
  }

  // Add external stream-specific fields
  if (mediaItem.type === 'external') {
    const extItem = mediaItem as any;
    entry.url = extItem.url;
    entry.streamType = extItem.streamType;
  }

  queue.push(entry);
  saveQueue(queue); // Save to disk
  return true;
}

export function removeFromQueue(idOrIndex: string | number): QueueEntry | null {
  let index: number;
  
  if (typeof idOrIndex === 'number') {
    index = idOrIndex - 1; // Convert from 1-based to 0-based
  } else {
    index = queue.findIndex(entry => entry.id === idOrIndex);
  }
  
  if (index >= 0 && index < queue.length) {
    const removed = queue.splice(index, 1)[0];
    saveQueue(queue); // Save to disk
    return removed;
  }
  
  return null;
}

export function getQueue(): QueueEntry[] {
  return [...queue];
}

export function clearQueue(): void {
  queue = [];
  saveQueue(queue); // Save to disk
}

export function formatQueueEntry(entry: QueueEntry, index?: number): string {
  const prefix = index !== undefined ? `${index + 1}. ` : '';
  let title = entry.title;
  let typeInfo = `(${entry.type})`;
  
  if (entry.type === 'episode' && entry.showTitle) {
    const season = entry.seasonNum ? `S${String(entry.seasonNum).padStart(2, '0')}` : '';
    const episode = entry.episodeNum ? `E${String(entry.episodeNum).padStart(2, '0')}` : '';
    title = `${entry.showTitle} ${season}${episode} - ${entry.title}`;
  } else if (entry.type === 'youtube' && entry.uploader) {
    typeInfo = `(YouTube • ${entry.uploader})`;
    if (entry.viewCount) {
      typeInfo += ` • ${entry.viewCount}`;
    }
  } else if (entry.type === 'external' && entry.streamType) {
    typeInfo = `(External • ${entry.streamType})`;
  }
  
  return `${prefix}${title} ${typeInfo}`;
}

export function peekQueue(): QueueEntry | undefined {
  return queue[0];
}

export function popQueue(): QueueEntry | undefined {
  return queue.shift();
}
