import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { QueueEntry } from './queue.js';
import type { WatchDeckEntry } from './watch-deck.js';

const QUEUE_FILE = join(process.cwd(), 'data', 'queue.json');
const WATCHED_VIDEOS_FILE = join(process.cwd(), 'data', 'watched-videos.json');
const WATCH_DECK_FILE = join(process.cwd(), 'data', 'watch-deck.json');

// Ensure data directory exists
function ensureDataDir(): void {
  const dataDir = join(process.cwd(), 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
    console.log('[Storage] Created data directory');
  }
}

export function saveQueue(queue: QueueEntry[]): void {
  try {
    ensureDataDir();
    writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
    console.log('[QueueStorage] Saved queue to disk');
  } catch (error) {
    console.error('[QueueStorage] Failed to save queue:', error);
  }
}

export function loadQueue(): QueueEntry[] {
  try {
    if (!existsSync(QUEUE_FILE)) {
      return [];
    }
    const data = readFileSync(QUEUE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[QueueStorage] Failed to load queue:', error);
    return [];
  }
}

export function saveWatchDeck(watchDeck: WatchDeckEntry[]): void {
  try {
    ensureDataDir();
    writeFileSync(WATCH_DECK_FILE, JSON.stringify(watchDeck, null, 2));
    console.log('[WatchDeck] Saved watch deck to disk');
  } catch (error) {
    console.error('[WatchDeck] Failed to save watch deck:', error);
  }
}

export function loadWatchDeck(): WatchDeckEntry[] {
  try {
    if (!existsSync(WATCH_DECK_FILE)) {
      return [];
    }
    const data = readFileSync(WATCH_DECK_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('[WatchDeck] Failed to load watch deck:', error);
    return [];
  }
}

export function saveWatchedVideos(watchedVideos: Set<string>): void {
  try {
    ensureDataDir();
    writeFileSync(WATCHED_VIDEOS_FILE, JSON.stringify(Array.from(watchedVideos), null, 2));
    console.log('[WatchedVideos] Saved watched videos to disk');
  } catch (error) {
    console.error('[WatchedVideos] Failed to save watched videos:', error);
  }
}

export function loadWatchedVideos(): Set<string> {
  try {
    if (!existsSync(WATCHED_VIDEOS_FILE)) {
      return new Set();
    }
    const data = readFileSync(WATCHED_VIDEOS_FILE, 'utf8');
    return new Set(JSON.parse(data));
  } catch (error) {
    console.error('[WatchedVideos] Failed to load watched videos:', error);
    return new Set();
  }
}
