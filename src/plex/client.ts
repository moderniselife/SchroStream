import config from '../config.js';
import type { PlexMediaItem, PlexStreamInfo } from '../types/index.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

// Track active Plex sessions for cleanup
const SESSIONS_FILE = join(process.cwd(), 'data', 'plex-sessions.json');
let activeSessions: Set<string> = new Set();

function loadSessions(): void {
  try {
    if (existsSync(SESSIONS_FILE)) {
      const data = readFileSync(SESSIONS_FILE, 'utf-8');
      activeSessions = new Set(JSON.parse(data));
      console.log(`[Plex] Loaded ${activeSessions.size} session(s) to cleanup`);
    }
  } catch {
    activeSessions = new Set();
  }
}

function saveSessions(): void {
  try {
    const dataDir = join(process.cwd(), 'data');
    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true });
    }
    writeFileSync(SESSIONS_FILE, JSON.stringify([...activeSessions]));
  } catch (error) {
    console.error('[Plex] Failed to save sessions:', error);
  }
}

export function trackSession(sessionId: string): void {
  activeSessions.add(sessionId);
  saveSessions();
}

export function untrackSession(sessionId: string): void {
  activeSessions.delete(sessionId);
  saveSessions();
}

export function getActiveSessions(): string[] {
  return [...activeSessions];
}

export class PlexClient {
  private baseUrl: string;
  private token: string;

  constructor() {
    this.baseUrl = config.plex.url;
    this.token = config.plex.token;
  }

  private async request<T>(endpoint: string): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const separator = endpoint.includes('?') ? '&' : '?';
    const fullUrl = `${url}${separator}X-Plex-Token=${this.token}`;

    const response = await fetch(fullUrl, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Plex API error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.request('/');
      return true;
    } catch {
      return false;
    }
  }

  async getLibraries(): Promise<Array<{ key: string; title: string; type: string }>> {
    const response = await this.request<any>('/library/sections');
    const directories = response.MediaContainer?.Directory;

    if (!directories) return [];

    const libs = Array.isArray(directories) ? directories : [directories];
    return libs.map((dir: any) => ({
      key: String(dir.key),
      title: dir.title,
      type: dir.type,
    }));
  }

  async search(query: string): Promise<PlexMediaItem[]> {
    let results: PlexMediaItem[] = [];

    // Try global search first
    try {
      const response = await this.request<any>(`/search?query=${encodeURIComponent(query)}`);
      const container = response.MediaContainer;

      if (container?.Metadata) {
        const items = Array.isArray(container.Metadata)
          ? container.Metadata
          : [container.Metadata];

        results = items
          .filter((item: any) => ['movie', 'show', 'episode'].includes(item.type))
          .map((item: any) => this.parseMediaItem(item));
      }
    } catch (err) {
      console.log('[Plex] Global search failed, trying library search...');
    }

    // If no results, search each library
    if (results.length === 0) {
      const libraries = await this.getLibraries();
      
      for (const lib of libraries) {
        try {
          const response = await this.request<any>(
            `/library/sections/${lib.key}/search?type=1&query=${encodeURIComponent(query)}`
          );
          const container = response.MediaContainer;

          if (container?.Metadata) {
            const items = Array.isArray(container.Metadata)
              ? container.Metadata
              : [container.Metadata];

            const libResults = items.map((item: any) => this.parseMediaItem(item));
            results.push(...libResults);
          }
        } catch {
          // Try show search (type=2)
          try {
            const response = await this.request<any>(
              `/library/sections/${lib.key}/search?type=2&query=${encodeURIComponent(query)}`
            );
            const container = response.MediaContainer;

            if (container?.Metadata) {
              const items = Array.isArray(container.Metadata)
                ? container.Metadata
                : [container.Metadata];

              const libResults = items.map((item: any) => this.parseMediaItem(item));
              results.push(...libResults);
            }
          } catch {
            // Ignore library search errors
          }
        }
      }
    }

    return results;
  }

  async getMetadata(ratingKey: string): Promise<PlexMediaItem | null> {
    try {
      const response = await this.request<any>(`/library/metadata/${ratingKey}`);
      const metadata = response.MediaContainer?.Metadata;

      if (!metadata) return null;

      const item = Array.isArray(metadata) ? metadata[0] : metadata;
      return this.parseMediaItem(item);
    } catch {
      return null;
    }
  }

  async getEpisodes(showKey: string): Promise<PlexMediaItem[]> {
    const response = await this.request<any>(`/library/metadata/${showKey}/allLeaves`);
    const container = response.MediaContainer;

    if (!container || !container.Metadata) return [];

    const items = Array.isArray(container.Metadata)
      ? container.Metadata
      : [container.Metadata];

    return items.map((item: any) => this.parseMediaItem(item));
  }

  async getSeasons(showKey: string): Promise<PlexMediaItem[]> {
    const response = await this.request<any>(`/library/metadata/${showKey}/children`);
    const container = response.MediaContainer;

    if (!container || !container.Metadata) return [];

    const items = Array.isArray(container.Metadata)
      ? container.Metadata
      : [container.Metadata];

    return items.map((item: any) => this.parseMediaItem(item));
  }

  async getSeasonEpisodes(seasonKey: string): Promise<PlexMediaItem[]> {
    const response = await this.request<any>(`/library/metadata/${seasonKey}/children`);
    const container = response.MediaContainer;

    if (!container || !container.Metadata) return [];

    const items = Array.isArray(container.Metadata)
      ? container.Metadata
      : [container.Metadata];

    return items.map((item: any) => this.parseMediaItem(item));
  }

  getStreamUrl(ratingKey: string): string {
    return `${this.baseUrl}/library/metadata/${ratingKey}?X-Plex-Token=${this.token}`;
  }

  async getDirectStreamUrl(ratingKey: string): Promise<PlexStreamInfo | null> {
    try {
      const response = await this.request<any>(`/library/metadata/${ratingKey}`);
      const metadata = response.MediaContainer?.Metadata;

      if (!metadata) return null;

      const item = Array.isArray(metadata) ? metadata[0] : metadata;
      const media = item.Media;

      if (!media) return null;

      const mediaInfo = Array.isArray(media) ? media[0] : media;
      const part = mediaInfo.Part;

      if (!part) return null;

      const partInfo = Array.isArray(part) ? part[0] : part;

      // Use HLS streaming - works with cloud mounts (zurg, rclone, etc.)
      const sessionId = `schrostream-${Date.now()}`;
      trackSession(sessionId); // Track for cleanup on restart
      
      const params = new URLSearchParams({
        path: `/library/metadata/${ratingKey}`,
        mediaIndex: '0',
        partIndex: '0',
        protocol: 'hls',
        session: sessionId,
        fastSeek: '1',
        directPlay: '0',
        directStream: '1',
        subtitleSize: '100',
        audioBoost: '100',
        location: 'lan',
        autoAdjustQuality: '0',
        directStreamAudio: '1',
        mediaBufferSize: '102400',
        'X-Plex-Session-Identifier': sessionId,
        'X-Plex-Token': this.token,
        'X-Plex-Client-Identifier': 'SchroStream',
        'X-Plex-Product': 'SchroStream',
        'X-Plex-Device': 'Node',
        'X-Plex-Platform': 'Node',
      });

      return {
        url: `${this.baseUrl}/video/:/transcode/universal/start.m3u8?${params.toString()}`,
        container: 'm3u8',
        videoCodec: mediaInfo.videoCodec,
        audioCodec: mediaInfo.audioCodec,
        bitrate: parseInt(mediaInfo.bitrate || '0', 10),
        width: parseInt(mediaInfo.width || '0', 10),
        height: parseInt(mediaInfo.height || '0', 10),
      };
    } catch (error) {
      console.error('Error getting stream URL:', error);
      return null;
    }
  }

  getTranscodeUrl(ratingKey: string, options: { width?: number; height?: number } = {}): string {
    const width = options.width || 1920;
    const height = options.height || 1080;

    const params = new URLSearchParams({
      path: `/library/metadata/${ratingKey}`,
      mediaIndex: '0',
      partIndex: '0',
      protocol: 'http',
      fastSeek: '1',
      directPlay: '0',
      directStream: '1',
      subtitleSize: '100',
      audioBoost: '100',
      location: 'lan',
      maxVideoBitrate: config.stream.maxBitrate.toString(),
      videoResolution: `${width}x${height}`,
      videoQuality: '100',
      'X-Plex-Token': this.token,
    });

    return `${this.baseUrl}/video/:/transcode/universal/start.m3u8?${params.toString()}`;
  }

  getThumbnailUrl(thumb: string): string {
    if (!thumb) return '';
    return `${this.baseUrl}${thumb}?X-Plex-Token=${this.token}`;
  }

  async stopTranscodeSession(sessionId?: string): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        'X-Plex-Token': this.token,
      });
      if (sessionId) {
        params.set('session', sessionId);
      }
      
      const url = `${this.baseUrl}/video/:/transcode/universal/stop?${params.toString()}`;
      const response = await fetch(url, { method: 'GET' });
      console.log('[Plex] Stopped transcode session', sessionId || '(all)', response.ok ? '✓' : `(${response.status})`);
      
      // Only untrack AFTER successful stop
      if (sessionId && response.ok) {
        untrackSession(sessionId);
      }
      return response.ok;
    } catch (error) {
      console.error('[Plex] Failed to stop transcode session:', sessionId, error);
      return false;
    }
  }

  async cleanupOldSessions(): Promise<void> {
    loadSessions();
    const sessions = getActiveSessions();
    if (sessions.length === 0) return;
    
    console.log(`[Plex] Cleaning up ${sessions.length} stale session(s)...`);
    for (const sessionId of sessions) {
      const stopped = await this.stopTranscodeSession(sessionId);
      if (!stopped) {
        // If stop failed, still untrack to prevent infinite retries on non-existent sessions
        untrackSession(sessionId);
      }
    }
    console.log('[Plex] Cleanup complete');
  }

  private parseMediaItem(item: any): PlexMediaItem {
    return {
      ratingKey: String(item.ratingKey),
      key: item.key,
      type: item.type,
      title: item.title,
      year: item.year ? parseInt(String(item.year), 10) : undefined,
      summary: item.summary,
      thumb: item.thumb,
      art: item.art,
      duration: item.duration ? parseInt(String(item.duration), 10) : undefined,
      addedAt: item.addedAt ? parseInt(String(item.addedAt), 10) : undefined,
      parentTitle: item.parentTitle,
      grandparentTitle: item.grandparentTitle,
      index: item.index ? parseInt(String(item.index), 10) : undefined,
      parentIndex: item.parentIndex ? parseInt(String(item.parentIndex), 10) : undefined,
    };
  }
}

export const plexClient = new PlexClient();
export default plexClient;
