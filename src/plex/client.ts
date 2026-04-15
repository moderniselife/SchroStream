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
          .filter((item: any) => ['movie', 'show', 'episode', 'channel'].includes(item.type))
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
    const searchResults = data?.MediaContainer?.SearchResult || [];

    // Extract metadata from SearchResult array
    const items = searchResults
      .map((result: any) => result.Metadata)
      .filter((item: any) => item && ['movie', 'show', 'episode', 'channel'].includes(item.type));

    return items.map((item: any) => this.parseMediaItem(item));
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

  async getDirectStreamUrl(ratingKey: string, sessionId?: string): Promise<PlexStreamInfo | null> {
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
      const finalSessionId = sessionId || `schrostream-${Date.now()}`;
      if (!sessionId) {
        trackSession(finalSessionId); // Track for cleanup on restart
      }

      const params = new URLSearchParams({
        path: `/library/metadata/${ratingKey}`,
        mediaIndex: '0',
        partIndex: '0',
        protocol: 'hls',
        session: finalSessionId,
        fastSeek: '1',
        directPlay: '0',
        directStream: '0',
        subtitleSize: '100',
        audioBoost: '100',
        location: 'lan',
        autoAdjustQuality: '0',
        directStreamAudio: '0',
        mediaBufferSize: '102400',
        // Tell Plex to transcode to Discord-compatible H264 at 30fps
        // This lets FFmpeg pass through video without re-encoding
        maxVideoBitrate: String(config.stream.maxBitrate),
        videoQuality: '100',
        videoResolution: `${Math.round(config.stream.defaultQuality * (16/9))}x${config.stream.defaultQuality}`,
        videoCodec: 'h264',
        // Force 30fps output - Plex content is typically 23.976fps which causes
        // stutter in Discord's 30fps RTP pipeline
        videoFrameRate: String(config.stream.frameRate),
        subtitles: 'burn',
        'X-Plex-Session-Identifier': finalSessionId,
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

  /**
   * Send a timeline update to Plex to report playback state
   * This is how Plex UI reports playing/paused/stopped state
   */
  async updateTimeline(
    ratingKey: string,
    state: 'playing' | 'paused' | 'stopped',
    timeMs: number,
    durationMs: number
  ): Promise<boolean> {
    try {
      const params = new URLSearchParams({
        ratingKey,
        key: `/library/metadata/${ratingKey}`,
        state,
        time: Math.floor(timeMs).toString(),
        duration: Math.floor(durationMs).toString(),
        'X-Plex-Product': 'SchroStream',
        'X-Plex-Version': '1.0.0',
        'X-Plex-Client-Identifier': config.plex.clientIdentifier,
        'X-Plex-Platform': 'Discord',
        'X-Plex-Device': 'SchroStream Bot',
        'X-Plex-Token': this.token,
      });

      const url = `${this.baseUrl}/:/timeline?${params.toString()}`;
      const response = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });

      if (response.ok) {
        console.log(`[Plex] Timeline updated: ${state} at ${Math.floor(timeMs / 1000)}s`);
        return true;
      } else {
        console.warn(`[Plex] Timeline update failed: ${response.status}`);
        return false;
      }
    } catch (error) {
      console.error('[Plex] Timeline update error:', error);
      return false;
    }
  }

  async stopTranscodeSession(sessionId?: string): Promise<boolean> {
    try {
      // Get the target Plex username from environment
      const targetUsername = process.env.PLEX_USERNAME;

      // First, get active sessions to find the Plex session ID
      const sessionsUrl = `${this.baseUrl}/status/sessions?X-Plex-Token=${this.token}`;
      const sessionsResponse = await fetch(sessionsUrl, {
        headers: { 'Accept': 'application/json' }
      });

      if (!sessionsResponse.ok) {
        console.warn('[Plex] Failed to get active sessions:', sessionsResponse.status);
      } else {
        const data = await sessionsResponse.json() as any;
        const sessions = data?.MediaContainer?.Metadata || [];
        console.log(`[Plex] Found ${sessions.length} active transcode sessions`);

        // Find sessions from the specific user
        for (const session of sessions) {
          const plexSessionId = session.Session?.id;
          const sessionUser = session.User?.title;

          console.log(`[Plex] Session user: ${sessionUser}, target: ${targetUsername}`);

          // If no target username set, stop all sessions (cleanup mode)
          // Otherwise, only stop sessions for the target user
          if (plexSessionId && (!targetUsername || sessionUser === targetUsername)) {
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

      // Always try the transcode stop endpoint - this is the most important cleanup
      console.log('[Plex] Stopping all transcode sessions...');

      // First try the universal stop endpoint
      const stopParams = new URLSearchParams({
        'X-Plex-Token': this.token,
      });
      if (sessionId) {
        stopParams.set('session', sessionId);
      }

      // If we have a specific session ID, try the DELETE endpoint
      if (sessionId) {

        // this is safe - it only stops the specific session 
        try {
          console.log(`[Plex] Attempting to DELETE transcode session: ${sessionId}`);
          const deleteResponse = await fetch(`${this.baseUrl}/transcode/sessions/${sessionId}?X-Plex-Token=${this.token}`, {
            method: 'DELETE',
          });
          console.log(`[Plex] DELETE transcode session response:`, deleteResponse.status);
        } catch (e) {
          console.log(`[Plex] DELETE transcode session failed:`, e);
        }

        // this is dangerous - it stops all transcode sessions if sessionId is not provided 
        try {
          const response = await fetch(`${this.baseUrl}/video/:/transcode/universal/stop?${stopParams.toString()}`);
          console.log(`[Plex] Universal stop response:`, response.status);
        } catch (e) {
          console.log(`[Plex] Universal stop failed:`, e);
        }
      }

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
    
    // Always try to stop any active transcodes for our user on startup
    // This catches transcodes that weren't properly cleaned up
    console.log('[Plex] Cleaning up any stale transcode sessions...');
    
    try {
      // Query transcode sessions endpoint
      const transcodeUrl = `${this.baseUrl}/transcode/sessions?X-Plex-Token=${this.token}`;
      const response = await fetch(transcodeUrl, {
        headers: { 'Accept': 'application/json' }
      });
      
      if (response.ok) {
        const data = await response.json() as any;
        const transcodes = data?.MediaContainer?.TranscodeSession || [];
        console.log(`[Plex] Found ${transcodes.length} active transcode(s)`);
        
        for (const transcode of transcodes) {
          const key = transcode.key;
          if (key) {
            console.log(`[Plex] Stopping transcode: ${key}`);
            await fetch(`${this.baseUrl}/transcode/sessions/${key}?X-Plex-Token=${this.token}`, {
              method: 'DELETE'
            });
          }
        }
      }
    } catch (error) {
      console.log('[Plex] Could not query transcode sessions:', error);
    }
    
    // Also clean up tracked sessions
    if (sessions.length > 0) {
      console.log(`[Plex] Cleaning up ${sessions.length} tracked session(s)...`);
      for (const sessionId of sessions) {
        const stopped = await this.stopTranscodeSession(sessionId);
        if (!stopped) {
          // If stop failed, still untrack to prevent infinite retries on non-existent sessions
          untrackSession(sessionId);
        }
      }
    }
    
    console.log('[Plex] Cleanup complete');
  }

  async getLiveTVChannels(): Promise<PlexMediaItem[]> {
    try {
      // Get all DVRs
      const response = await this.request<any>('/livetv/dvrs');
      const container = response.MediaContainer;

      if (!container?.Dvr) {
        console.log('[Plex] No DVRs found');
        return [];
      }

      const dvrs = Array.isArray(container.Dvr) ? container.Dvr : [container.Dvr];
      console.log(`[Plex] Found ${dvrs.length} DVR(s):`);
      dvrs.forEach((dvr: any) => {
        console.log(`  - DVR ${dvr.key}: ${dvr.title || 'Untitled'}`);
      });

      const allChannels: PlexMediaItem[] = [];

      // Get channels from each DVR
      for (const dvrInfo of dvrs) {
        try {
          console.log(`[Plex] Fetching channels for DVR ${dvrInfo.key}...`);

          // First check if DVR has any channels configured
          const dvrStatus = await this.request<any>(`/livetv/dvrs/${dvrInfo.key}`);
          console.log(`[Plex] DVR ${dvrInfo.key} raw response:`, JSON.stringify(dvrStatus, null, 2));
          const dvrContainer: any = dvrStatus.MediaContainer;

          // Try different approaches to get channels
          console.log(`[Plex] DVR container size: ${dvrContainer?.size}`);
          console.log(`[Plex] DVR container keys:`, Object.keys(dvrContainer || {}));

          // Channels are in the ChannelMapping arrays of each device
          // Networks are in the Lineup array, devices correspond to networks
          const dvrList = Array.isArray(dvrContainer?.Dvr) ? dvrContainer.Dvr : [dvrContainer?.Dvr];

          for (const dvrData of dvrList) {
            if (!dvrData?.Device) continue;

            // Get networks from Lineup array
            const lineups = Array.isArray(dvrData.Lineup) ? dvrData.Lineup : [dvrData.Lineup];
            const devices = Array.isArray(dvrData.Device) ? dvrData.Device : [dvrData.Device];

            console.log(`[Plex] Found ${lineups.length} networks and ${devices.length} devices`);

            // Match each device to its network by title
            for (const device of devices) {
              if (!device?.ChannelMapping) continue;

              // Find the matching network for this device
              const network = lineups.find((lineup: any) => lineup.title === device.title);
              const networkName = network?.title || device.title || 'Unknown Network';

              console.log(`[Plex] Processing device: ${device.title} (${networkName})`);

              const channelMappings = Array.isArray(device.ChannelMapping)
                ? device.ChannelMapping
                : [device.ChannelMapping];

              console.log(`[Plex] Found ${channelMappings.length} channels in ${device.title}`);

              const parsedChannels = channelMappings.map((mapping: any) => ({
                ratingKey: `${dvrInfo.key}-${dvrData.key}-${device.key}-${mapping.deviceIdentifier}`,
                key: mapping.channelKey,
                type: 'channel',
                title: mapping.channelKey.replace(/-/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase()),
                year: undefined,
                summary: `Live TV channel - ${mapping.lineupIdentifier} (${networkName})`,
                thumb: undefined,
                art: undefined,
                duration: undefined, // Live TV has no duration
                addedAt: undefined,
                parentTitle: device.title,
                grandparentTitle: networkName,
                parentRatingKey: undefined,
                grandparentRatingKey: undefined,
                index: parseInt(mapping.deviceIdentifier, 10),
                parentIndex: undefined,
              }));

              allChannels.push(...parsedChannels);
            }
          }
        } catch (err) {
          console.error(`[Plex] Error getting channels for DVR ${dvrInfo.key}:`, err);
        }
      }

      return allChannels;
    } catch (error) {
      console.error('[Plex] Error getting Live TV channels:', error);
      return [];
    }
  }

  async getChannelStreamUrl(ratingKey: string): Promise<PlexStreamInfo | null> {
    try {
      // Parse the ratingKey to extract DVR key, DVR data key, device key, and device identifier
      const parts = ratingKey.split('-');
      if (parts.length < 3) {
        // Old format fallback
        const [dvrKey, deviceIdentifier] = parts;
        // Use old endpoint
        const response = await this.request<any>(`/livetv/dvrs/${dvrKey}/channels/${deviceIdentifier}/stream`);

        if (!response?.MediaContainer) {
          // Fallback: try the old method
          const fallbackResponse = await this.request<any>(`/library/metadata/${ratingKey}`);
          const container = fallbackResponse.MediaContainer;

          if (!container?.Metadata) return null;

          const channel = Array.isArray(container.Metadata) ? container.Metadata[0] : container.Metadata;

          // Get the Media part which contains the stream URL
          if (channel.Media && channel.Media.length > 0) {
            const media = Array.isArray(channel.Media) ? channel.Media[0] : channel.Media;
            if (media.Part && media.Part.length > 0) {
              const part = Array.isArray(media.Part) ? media.Part[0] : media.Part;
              const streamUrl = `${this.baseUrl}${part.key}`;

              return {
                url: streamUrl,
                container: media.container || 'mpegts',
              };
            }
          }

          // Fallback: construct stream URL directly
          const streamUrl = `${this.baseUrl}/library/metadata/${ratingKey}/file.m3u8`;
          return {
            url: streamUrl,
            container: 'mpegts',
          };
        }

        // Use the new Live TV endpoint response
        const streamUrl = `${this.baseUrl}${response.MediaContainer.key}`;
        return {
          url: streamUrl,
          container: 'mpegts',
        };
      }

      // New format: dvrKey-dvrDataKey-deviceKey-deviceIdentifier
      const [dvrKey, dvrDataKey, deviceKey, deviceIdentifier] = parts;

      console.log(`[Plex] Looking for Live TV stream: dvrKey=${dvrKey}, deviceKey=${deviceKey}, deviceIdentifier=${deviceIdentifier}`);

      // Try multiple approaches for Live TV streaming
      let response: any;

      // Approach 1: Try the assumed endpoint
      try {
        response = await this.request<any>(`/livetv/dvrs/${dvrKey}/channels/${deviceIdentifier}/stream`);
        console.log('[Plex] Approach 1 succeeded');
      } catch (err) {
        console.log('[Plex] Approach 1 failed:', err);

        // Approach 2: Try using deviceKey instead
        try {
          response = await this.request<any>(`/livetv/dvrs/${dvrKey}/devices/${deviceKey}/channels/${deviceIdentifier}/stream`);
          console.log('[Plex] Approach 2 succeeded');
        } catch (err2) {
          console.log('[Plex] Approach 2 failed:', err2);

          // Approach 3: Try getting channel metadata first
          try {
            const channelMeta = await this.request<any>(`/livetv/dvrs/${dvrKey}/channels/${deviceIdentifier}`);
            console.log('[Plex] Channel metadata:', channelMeta);

            // Look for Media container with stream URL
            if (channelMeta?.MediaContainer?.Metadata?.[0]?.Media?.[0]?.Part?.[0]?.key) {
              const streamKey = channelMeta.MediaContainer.Metadata[0].Media[0].Part[0].key;
              response = { MediaContainer: { key: streamKey } };
              console.log('[Plex] Approach 3 succeeded - found stream key in metadata');
            }
          } catch (err3) {
            console.log('[Plex] Approach 3 failed:', err3);
            // Approach 7: Fetch device lineup.json to find correct channel number
            try {
              // Get the device info
              const dvrStatus = await this.request<any>(`/livetv/dvrs/${dvrKey}`);
              const dvrData = Array.isArray(dvrStatus.MediaContainer.Dvr) ? dvrStatus.MediaContainer.Dvr[0] : dvrStatus.MediaContainer.Dvr;
              const devices = Array.isArray(dvrData.Device) ? dvrData.Device : [dvrData.Device];
              const device = devices.find((d: any) => d.key === deviceKey);

              if (device?.uri) {
                // Find the channel mapping to get lineupIdentifier
                const channelMappings = Array.isArray(device.ChannelMapping) ? device.ChannelMapping : [device.ChannelMapping];
                const mapping = channelMappings.find((m: any) => m.deviceIdentifier === deviceIdentifier);

                if (mapping?.lineupIdentifier) {
                  console.log(`[Plex] Looking for lineupIdentifier - approach 7: ${mapping.lineupIdentifier}`);

                  // Fetch the device's lineup.json
                  const fetch = await import('node-fetch');
                  console.log(`[Plex] Fetching lineup from: ${device.uri}/lineup.json`);
                  const lineupResponse = await fetch.default(`${device.uri}/lineup.json`);
                  const lineup = await lineupResponse.json() as any[];
                  console.log(`[Plex] Found ${lineup.length} channels in lineup`);

                  // Find the channel with matching lineupIdentifier
                  const channel = lineup.find((ch: any) =>
                    ch.lineupIdentifier === mapping.lineupIdentifier ||
                    ch.GuideName === mapping.lineupIdentifier ||
                    ch.URL?.includes(mapping.lineupIdentifier)
                  );

                  if (!channel) {
                    console.log(`[Plex] Channel not found for lineupIdentifier - approach 7: ${mapping.lineupIdentifier}`);
                    console.log(`[Plex] Available channels:`, lineup.map((ch: any) => `${ch.GuideName} (${ch.GuideNumber})`).slice(0, 10));
                  } else if (channel?.GuideNumber) {
                    const streamUrl = `${device.uri}/auto/v${channel.GuideNumber}`;
                    console.log(`[Plex] Approach 4: Found channel ${channel.GuideName} (${channel.GuideNumber}) - URL: ${streamUrl}`);

                    return {
                      url: streamUrl,
                      container: 'mpegts',
                    };
                  }
                }
              }
            } catch (err7) {
              console.log('[Plex] Approach 7 failed:', err7);

              // Approach 5: Try universal transcode
              try {
                const transcodeUrl = `${this.baseUrl}/video/:/transcode/universal/start.m3u8?X-Plex-Token=${this.token}&path=%2Flivetv%2Fdvrs%2F${dvrKey}%2Fchannels%2F${deviceIdentifier}`;
                console.log('[Plex] Approach 5: Trying transcode URL');

                return {
                  url: transcodeUrl,
                  container: 'mpegts',
                };
              } catch (err5) {
                console.log('[Plex] Approach 5 failed:', err5);

                // Approach 6: Try using channelKey from the original channel data
                try {
                  // Get all channels to find the channel key for this device
                  const allChannels = await this.getLiveTVChannels();
                  const channel = allChannels.find(ch => ch.ratingKey === ratingKey);

                  if (channel?.key) {
                    const channelStreamUrl = `${this.baseUrl}/livetv/channels/${channel.key}/stream?X-Plex-Token=${this.token}`;
                    console.log('[Plex] Approach 6: Trying channel key URL:', channelStreamUrl);

                    return {
                      url: channelStreamUrl,
                      container: 'mpegts',
                    };
                  }
                } catch (err6) {
                  console.log('[Plex] Approach 6 failed:', err6);


                }
              }
            }

            // // Approach 4: Fetch device lineup.json to find correct channel number
            // try {
            //   // Get the device info
            //   const dvrStatus = await this.request<any>(`/livetv/dvrs/${dvrKey}`);
            //   const dvrData = Array.isArray(dvrStatus.MediaContainer.Dvr) ? dvrStatus.MediaContainer.Dvr[0] : dvrStatus.MediaContainer.Dvr;
            //   const devices = Array.isArray(dvrData.Device) ? dvrData.Device : [dvrData.Device];
            //   const device = devices.find((d: any) => d.key === deviceKey);

            //   if (device?.uri) {
            //     // Find the channel mapping to get lineupIdentifier
            //     const channelMappings = Array.isArray(device.ChannelMapping) ? device.ChannelMapping : [device.ChannelMapping];
            //     const mapping = channelMappings.find((m: any) => m.deviceIdentifier === deviceIdentifier);

            //     if (mapping?.lineupIdentifier) {
            //       console.log(`[Plex] Looking for lineupIdentifier - approach 4: ${mapping.lineupIdentifier}`);

            //       // Fetch the device's lineup.json
            //       const fetch = await import('node-fetch');
            //       const lineupResponse = await fetch.default(`${device.uri}/lineup.json`);
            //       const lineup = await lineupResponse.json() as any[];

            //       // Find the channel with matching lineupIdentifier
            //       const channel = lineup.find((ch: any) => (ch.GuideName || ch.lineupIdentifier) === mapping.lineupIdentifier ||
            //         ch.URL.includes(mapping.lineupIdentifier));

            //       if (!channel) {
            //         console.log(`[Plex] Channel not found for lineupIdentifier - approach 4: ${mapping.GuideNumber}`);
            //       } else if (channel?.GuideNumber) {
            //         const streamUrl = `${device.uri}/auto/v${channel.GuideNumber}`;
            //         console.log(`[Plex] Approach 4: Found channel ${channel.GuideName} (${channel.GuideNumber}) - URL: ${streamUrl}`);

            //         return {
            //           url: streamUrl,
            //           container: 'mpegts',
            //         };
            //       }
            //     }
            //   }
            // } catch (err4) {
            //   console.log('[Plex] Approach 4 failed:', err4);



            // }
          }
        }
      }

      if (!response?.MediaContainer) {
        // Fallback: try the old method
        const fallbackResponse = await this.request<any>(`/library/metadata/${ratingKey}`);
        const container = fallbackResponse.MediaContainer;

        if (!container?.Metadata) return null;

        const channel = Array.isArray(container.Metadata) ? container.Metadata[0] : container.Metadata;

        // Get the Media part which contains the stream URL
        if (channel.Media && channel.Media.length > 0) {
          const media = Array.isArray(channel.Media) ? channel.Media[0] : channel.Media;
          if (media.Part && media.Part.length > 0) {
            const part = Array.isArray(media.Part) ? media.Part[0] : media.Part;
            const streamUrl = `${this.baseUrl}${part.key}`;

            return {
              url: streamUrl,
              container: media.container || 'mpegts',
            };
          }
        }

        // Fallback: construct stream URL directly
        const streamUrl = `${this.baseUrl}/library/metadata/${ratingKey}/file.m3u8`;
        return {
          url: streamUrl,
          container: 'mpegts',
        };
      }

      // Use the new Live TV endpoint response
      const streamUrl = `${this.baseUrl}${response.MediaContainer.key}`;
      return {
        url: streamUrl,
        container: 'mpegts',
      };
    } catch (error) {
      console.error('[Plex] Error getting channel stream URL:', error);
      return null;
    }
  }

  private parseMediaItem(item: any): PlexMediaItem {
    const duration = item.duration ? parseInt(String(item.duration), 10) : undefined;

    // Log all durations for debugging
    if (duration) {
      console.log(`[Plex] Parsed duration for "${item.title}": ${duration}ms (${Math.round(duration / 60000)} minutes)`);
      if (duration > 1000000000) {
        console.log(`[Plex] Warning: Very large duration for "${item.title}": ${duration}ms (${Math.round(duration / 3600000)} hours)`);
      }
    }

    return {
      ratingKey: String(item.ratingKey),
      key: item.key,
      type: item.type,
      title: item.title,
      year: item.year ? parseInt(String(item.year), 10) : undefined,
      summary: item.summary,
      thumb: item.thumb,
      art: item.art,
      duration: duration,
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
