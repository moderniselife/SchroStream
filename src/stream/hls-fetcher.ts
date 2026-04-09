import { spawn, ChildProcess } from 'child_process';
import { Readable } from 'stream';

interface HLSSegment {
  url: string;
  duration: number;
}

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Referer': 'https://www.google.com/',
  'Origin': 'https://www.google.com',
  'Accept': '*/*',
};

/**
 * Custom HLS fetcher that bypasses FFmpeg's segment extension restrictions
 * by downloading segments manually and piping raw MPEG-TS data
 */
export class HLSFetcher {
  private baseUrl: string = '';
  private isRunning: boolean = false;
  private abortController: AbortController | null = null;

  /**
   * Fetch m3u8 playlist and parse segment URLs
   */
  private async fetchPlaylist(url: string): Promise<HLSSegment[]> {
    const response = await fetch(url, { headers: BROWSER_HEADERS });
    if (!response.ok) {
      throw new Error(`Failed to fetch playlist: ${response.status}`);
    }
    
    const content = await response.text();
    const lines = content.split('\n');
    const segments: HLSSegment[] = [];
    let duration = 0;
    
    // Determine base URL for relative segment paths
    const urlObj = new URL(url);
    this.baseUrl = url.substring(0, url.lastIndexOf('/') + 1);
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.startsWith('#EXTINF:')) {
        // Parse duration
        const match = line.match(/#EXTINF:([\d.]+)/);
        if (match) {
          duration = parseFloat(match[1]);
        }
      } else if (line && !line.startsWith('#')) {
        // This is a segment URL
        let segmentUrl = line;
        if (!segmentUrl.startsWith('http')) {
          segmentUrl = this.baseUrl + segmentUrl;
        }
        segments.push({ url: segmentUrl, duration });
        duration = 0;
      }
    }
    
    return segments;
  }

  /**
   * Fetch a single segment and return its data
   */
  private async fetchSegment(url: string): Promise<ArrayBuffer> {
    const response = await fetch(url, { 
      headers: BROWSER_HEADERS,
      signal: this.abortController?.signal 
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch segment: ${response.status}`);
    }
    return response.arrayBuffer();
  }

  /**
   * Start streaming HLS content by fetching segments and piping to a writable stream
   */
  async startStreaming(playlistUrl: string, outputStream: NodeJS.WritableStream): Promise<void> {
    this.isRunning = true;
    this.abortController = new AbortController();
    
    console.log('[HLSFetcher] Starting to fetch:', playlistUrl);
    
    let lastSegmentUrl = '';
    
    while (this.isRunning) {
      try {
        // Fetch and parse playlist
        const segments = await this.fetchPlaylist(playlistUrl);
        
        if (segments.length === 0) {
          console.log('[HLSFetcher] No segments found, retrying...');
          await new Promise(resolve => setTimeout(resolve, 1000));
          continue;
        }
        
        // Find new segments (for live streams)
        let startIndex = 0;
        if (lastSegmentUrl) {
          const lastIndex = segments.findIndex(s => s.url === lastSegmentUrl);
          if (lastIndex >= 0) {
            startIndex = lastIndex + 1;
          }
        }
        
        // If no new segments, this might be a VOD - just fetch all
        if (startIndex === 0 && lastSegmentUrl) {
          // Live stream with no new segments yet
          await new Promise(resolve => setTimeout(resolve, 2000));
          continue;
        }
        
        // Fetch and write segments
        for (let i = startIndex; i < segments.length && this.isRunning; i++) {
          const segment = segments[i];
          
          try {
            const data = await this.fetchSegment(segment.url);
            outputStream.write(Buffer.from(data));
            lastSegmentUrl = segment.url;
          } catch (err) {
            if (!this.isRunning) break;
            console.error('[HLSFetcher] Error fetching segment:', err);
          }
        }
        
        // For live streams, wait before checking for new segments
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } catch (err) {
        if (!this.isRunning) break;
        console.error('[HLSFetcher] Error:', err);
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  }

  /**
   * Stop the HLS fetcher
   */
  stop(): void {
    this.isRunning = false;
    this.abortController?.abort();
  }
}

/**
 * Create a child process that fetches HLS and outputs raw MPEG-TS to stdout.
 * Supports custom headers for authenticated sources like Plex.
 * 
 * @param playlistUrl - The HLS m3u8 URL to fetch
 * @param customHeaders - Optional custom headers (e.g. Plex auth headers)
 */
export function createHLSFetcherProcess(
  playlistUrl: string, 
  customHeaders?: Record<string, string>
): ChildProcess {
  // Merge custom headers with defaults (custom takes priority)
  const headers = { ...BROWSER_HEADERS, ...(customHeaders || {}) };
  const headersJson = JSON.stringify(headers);
  
  // Use a simple node script to fetch and output segments
  const script = `
    const HEADERS = ${headersJson};
    
    console.error('[HLSFetcher] Starting with URL:', '${playlistUrl.substring(0, 80)}...');
    
    // Handle EPIPE errors gracefully (when FFmpeg closes)
    process.stdout.on('error', (err) => {
      if (err.code === 'EPIPE') {
        console.error('[HLSFetcher] Pipe closed, exiting...');
        process.exit(0);
      }
    });
    
    // Handle all other uncaught errors to prevent crashes
    process.on('uncaughtException', (err) => {
      if (err.code === 'EPIPE') {
        console.error('[HLSFetcher] Uncaught EPIPE, exiting...');
        process.exit(0);
      } else {
        console.error('[HLSFetcher] Uncaught exception:', err);
        process.exit(1);
      }
    });
    
    process.on('unhandledRejection', (reason, promise) => {
      console.error('[HLSFetcher] Unhandled rejection:', reason);
      process.exit(1);
    });
    
    async function fetchText(url) {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error('Fetch failed: ' + res.status);
      return res.text();
    }
    
    async function fetchBinary(url) {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) throw new Error('Fetch failed: ' + res.status);
      return res.arrayBuffer();
    }
    
    function parsePlaylist(text, baseUrl) {
      const segments = [];
      const lines = text.split('\\n');
      let hasEndList = false;
      for (const line of lines) {
        const l = line.trim();
        if (l === '#EXT-X-ENDLIST') hasEndList = true;
        if (l && !l.startsWith('#')) {
          let url = l.startsWith('http') ? l : baseUrl + l;
          segments.push(url);
        }
      }
      return { segments, hasEndList };
    }
    
    function getBaseUrl(url) {
      return url.substring(0, url.lastIndexOf('/') + 1);
    }
    
    async function findActualSegments(playlistUrl) {
      console.error('[HLSFetcher] Fetching playlist:', playlistUrl.substring(0, 80) + '...');
      const text = await fetchText(playlistUrl);
      const baseUrl = getBaseUrl(playlistUrl);
      const { segments: entries } = parsePlaylist(text, baseUrl);
      
      console.error('[HLSFetcher] Found', entries.length, 'entries');
      
      // Check if first entry is another playlist or actual segment
      if (entries.length > 0) {
        const firstEntry = entries[0];
        const sample = await fetchText(firstEntry);
        
        // If it starts with #EXTM3U, it's a nested playlist
        if (sample.trim().startsWith('#EXTM3U') || sample.trim().startsWith('#EXT')) {
          console.error('[HLSFetcher] Entry is a nested playlist, parsing...');
          const nestedBaseUrl = getBaseUrl(firstEntry);
          const { segments: actualSegments } = parsePlaylist(sample, nestedBaseUrl);
          console.error('[HLSFetcher] Found', actualSegments.length, 'actual segments');
          return { playlistUrl: firstEntry, segments: actualSegments };
        }
      }
      
      return { playlistUrl, segments: entries };
    }
    
    async function main() {
      let lastSeg = '';
      let variantPlaylistUrl = null;
      let totalBytes = 0;
      let segCount = 0;
      
      // First, find the actual segments playlist
      const initial = await findActualSegments('${playlistUrl}');
      variantPlaylistUrl = initial.playlistUrl;
      
      while (true) {
        try {
          const text = await fetchText(variantPlaylistUrl);
          const baseUrl = getBaseUrl(variantPlaylistUrl);
          const { segments, hasEndList } = parsePlaylist(text, baseUrl);
          
          if (segments.length === 0) {
            console.error('[HLSFetcher] No segments found, retrying...');
            await new Promise(r => setTimeout(r, 2000));
            continue;
          }
          
          // Find new segments
          let start = 0;
          if (lastSeg) {
            const idx = segments.indexOf(lastSeg);
            if (idx >= 0) start = idx + 1;
          }
          
          if (start >= segments.length) {
            if (hasEndList) {
              console.error('[HLSFetcher] End of stream (ENDLIST), total:', totalBytes, 'bytes,', segCount, 'segments');
              process.exit(0);
            }
            // No new segments, wait for more
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }
          
          for (let i = start; i < segments.length; i++) {
            const segUrl = segments[i];
            
            try {
              const buf = await fetchBinary(segUrl);
              
              if (buf.byteLength > 100) {
                process.stdout.write(Buffer.from(buf));
                lastSeg = segUrl;
                totalBytes += buf.byteLength;
                segCount++;
                
                if (segCount % 10 === 0) {
                  console.error('[HLSFetcher] Progress:', segCount, 'segments,', (totalBytes / 1024 / 1024).toFixed(1), 'MB');
                }
              }
            } catch (e) {
              console.error('[HLSFetcher] Segment fetch error:', e.message);
            }
          }
          
          // Check if we've consumed all segments in a VOD
          if (hasEndList && lastSeg === segments[segments.length - 1]) {
            console.error('[HLSFetcher] All segments consumed, total:', totalBytes, 'bytes,', segCount, 'segments');
            process.exit(0);
          }
          
          await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
          console.error('[HLSFetcher] Error:', e.message);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }
    main().catch(e => console.error('[HLSFetcher] Fatal:', e));
  `;
  
  return spawn('node', ['-e', script], {
    stdio: ['ignore', 'pipe', 'pipe']
  });
}
