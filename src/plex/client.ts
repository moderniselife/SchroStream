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

  async getLibraryItems(libraryKey: string): Promise<PlexMediaItem[]> {
    try {
      const response = await this.request<any>(`/library/sections/${libraryKey}/all`);
      const container = response.MediaContainer;
      
      if (!container?.Metadata) return [];
      
      const items = Array.isArray(container.Metadata) ? container.Metadata : [container.Metadata];
      return items.map((item: any) => this.parseMediaItem(item));
    } catch (error) {
      console.error('[Plex] Error getting library items:', error);
      return [];
    }
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

    // If still no results, try the comprehensive search endpoint
    if (results.length === 0) {
      console.log('[Plex] No results from standard search, trying comprehensive search...');
      try {
        results = await this.comprehensiveSearch(query);
      } catch (err) {
        console.log('[Plex] Comprehensive search failed:', err);
      }
    }

    return results;
  }

  async comprehensiveSearch(query: string): Promise<PlexMediaItem[]> {
    const searchUrl = `${this.baseUrl}/library/search?query=${encodeURIComponent(query)}&limit=100&searchTypes=movies,tv&includeCollections=1&includeExternalMedia=1&X-Plex-Token=${this.token}`;
    
    const response = await fetch(searchUrl, {
      headers: {
        'Accept': 'application/json',
        'X-Plex-Product': 'SchroStream',
        'X-Plex-Version': '1.0.0',
        'X-Plex-Client-Identifier': 'schrostream-controller',
        'X-Plex-Platform': 'Node',
        'X-Plex-Device': 'SchroStream',
      }
    });

    if (!response.ok) {
      throw new Error(`Comprehensive search error: ${response.status}`);
    }

    const data = await response.json() as any;
    const items = data?.MediaContainer?.Metadata || [];

    return items
      .filter((item: any) => ['movie', 'show', 'episode'].includes(item.type))
      .map((item: any) => this.parseMediaItem(item));
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

  async getEpisode(showKey: string, seasonNum: number, episodeNum: number): Promise<PlexMediaItem | null> {
    const seasons = await this.getSeasons(showKey);
    const targetSeason = seasons.find(s => s.index === seasonNum);
    
    if (!targetSeason) return null;
    
    const episodes = await this.getSeasonEpisodes(targetSeason.ratingKey);
    return episodes.find(e => e.index === episodeNum) || null;
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
      // Get the target Plex username from environment
      const targetUsername = process.env.PLEX_USERNAME;
      if (!targetUsername) {
        console.warn('[Plex] PLEX_USERNAME not set, skipping transcode cleanup');
        return false;
      }
      
      // First, get active sessions to find the Plex session ID
      const sessionsUrl = `${this.baseUrl}/status/sessions?X-Plex-Token=${this.token}`;
      const sessionsResponse = await fetch(sessionsUrl, {
        headers: { 'Accept': 'application/json' }
      });
      
      if (sessionsResponse.ok) {
        const data = await sessionsResponse.json() as any;
        const sessions = data?.MediaContainer?.Metadata || [];
        
        // Find sessions from the specific user
        for (const session of sessions) {
          const plexSessionId = session.Session?.id;
          const sessionUser = session.User?.title;
          
          // Only stop sessions for the target user
          if (plexSessionId && sessionUser === targetUsername) {
            const params = new URLSearchParams({
              'sessionId': plexSessionId,
              'reason': 'SchroStream cleanup',
              'X-Plex-Token': this.token,
            });
            
            const terminateUrl = `${this.baseUrl}/status/sessions/terminate?${params.toString()}`;
            const response = await fetch(terminateUrl);
            console.log(`[Plex] Terminated Plex session for ${sessionUser}`, plexSessionId, response.ok ? '✓' : `(${response.status})`);
          }
        }
      }
      
      // Also try the transcode stop endpoint as fallback
      const stopParams = new URLSearchParams({
        'X-Plex-Token': this.token,
      });
      if (sessionId) {
        stopParams.set('session', sessionId);
      }
      const stopUrl = `${this.baseUrl}/video/:/transcode/universal/stop?${stopParams.toString()}`;
      await fetch(stopUrl);
      
      // Untrack our session
      if (sessionId) {
        untrackSession(sessionId);
      }
      
      return true;
    } catch (error) {
      console.error('[Plex] Failed to terminate session:', sessionId, error);
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
      parentRatingKey: item.parentRatingKey ? String(item.parentRatingKey) : undefined,
      grandparentRatingKey: item.grandparentRatingKey ? String(item.grandparentRatingKey) : undefined,
      index: item.index ? parseInt(String(item.index), 10) : undefined,
      parentIndex: item.parentIndex ? parseInt(String(item.parentIndex), 10) : undefined,
    };
  }
}

export const plexClient = new PlexClient();
export default plexClient;
