import { createHash } from 'crypto';
import { https } from 'follow-redirects';

const SPONSORBLOCK_API = 'https://sponsor.ajay.app/api';

export interface SponsorSegment {
  segment: [number, number]; // [start, end] in seconds
  UUID: string;
  category: string;
  actionType: string;
  locked: number;
  votes: number;
  videoDuration: number;
  description: string;
}

export interface SponsorBlockResponse {
  videoID: string;
  segments: SponsorSegment[];
}

// Categories to skip by default
const DEFAULT_CATEGORIES = [
  'sponsor',           // Sponsor
  'intro',             // Intermission/Intro Animation
  'outro',             // Endcards/Credits
  'selfpromo',         // Unpaid/Self Promotion
  'interaction',       // Interaction Reminder (Subscribe)
  'music_offtopic',    // Non-Music Section
  'preview',           // Preview/Recap
  'filler'             // Filler Tangent
];

// Optional categories that users might want
const OPTIONAL_CATEGORIES = [
  'poi_highlight',     // Highlight
  'exclusive_access'   // Exclusive Access
];

/**
 * Get SHA256 hash of video ID for privacy
 */
function getVideoHash(videoID: string, prefixLength: number = 4): string {
  return createHash('sha256').update(videoID).digest('hex').substring(0, prefixLength);
}

/**
 * Fetch sponsor segments for a YouTube video
 */
export async function getSponsorSegments(
  videoID: string, 
  categories: string[] = DEFAULT_CATEGORIES
): Promise<SponsorSegment[]> {
  return new Promise((resolve, reject) => {
    const hash = getVideoHash(videoID);
    const categoryParams = categories.map(cat => `category=${cat}`).join('&');
    const url = `${SPONSORBLOCK_API}/skipSegments/${hash}?${categoryParams}&service=YouTube`;
    
    console.log(`[SponsorBlock] Fetching segments for video ${videoID} (hash: ${hash})`);
    
    const request = https.get(url, (response) => {
      let data = '';
      
      response.on('data', (chunk) => {
        data += chunk;
      });
      
      response.on('end', () => {
        try {
          if (response.statusCode === 404) {
            console.log(`[SponsorBlock] No segments found for video ${videoID}`);
            resolve([]);
            return;
          }
          
          if (response.statusCode !== 200) {
            throw new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`);
          }
          
          const results: SponsorBlockResponse[] = JSON.parse(data);
          
          // Find the matching video result
          const videoResult = results.find(result => result.videoID === videoID);
          if (!videoResult) {
            console.log(`[SponsorBlock] No exact match for video ${videoID}`);
            resolve([]);
            return;
          }
          
          console.log(`[SponsorBlock] Found ${videoResult.segments.length} segments for video ${videoID}`);
          
          // Sort segments by start time
          const sortedSegments = videoResult.segments.sort((a, b) => a.segment[0] - b.segment[0]);
          resolve(sortedSegments);
        } catch (error) {
          console.error('[SponsorBlock] Error parsing response:', error);
          reject(error);
        }
      });
    });
    
    request.on('error', (error) => {
      console.error('[SponsorBlock] Request failed:', error);
      reject(error);
    });
    
    request.setTimeout(5000, () => {
      request.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Generate FFmpeg filter complex to skip sponsor segments
 */
export function generateSkipFilter(segments: SponsorSegment[], videoDuration: number): string[] {
  if (segments.length === 0) {
    return [];
  }
  
  console.log(`[SponsorBlock] Generating skip filter for ${segments.length} segments`);
  
  // Merge overlapping or adjacent segments
  const mergedSegments = mergeSegments(segments);
  console.log(`[SponsorBlock] Merged to ${mergedSegments.length} segments`);
  
  // If segments cover the entire video, return empty
  const totalSkipTime = mergedSegments.reduce((sum, seg) => sum + (seg.segment[1] - seg.segment[0]), 0);
  if (totalSkipTime >= videoDuration * 0.95) {
    console.log('[SponsorBlock] Segments cover entire video, skipping filter');
    return [];
  }
  
  // Generate filter to skip segments
  // We'll use the 'select' filter to only keep frames outside sponsor segments
  const filterParts: string[] = [];
  let currentTime = 0;
  
  for (const segment of mergedSegments) {
    const [start, end] = segment.segment;
    
    // Add normal playback segment
    if (start > currentTime) {
      filterParts.push(`between(t,${currentTime},${start})`);
    }
    
    currentTime = end;
  }
  
  // Add final segment if there's remaining video
  if (currentTime < videoDuration) {
    filterParts.push(`between(t,${currentTime},${videoDuration})`);
  }
  
  if (filterParts.length === 0) {
    return [];
  }
  
  // Combine all conditions with '+'
  const selectFilter = `select='${filterParts.join('+')}',setpts=N/FRAME_RATE/TB`;
  
  // For audio, we need to use aselect and asetpts
  const audioFilter = `aselect='${filterParts.join('+')}',asetpts=N/SR/TB`;
  
  return [selectFilter, audioFilter];
}

/**
 * Merge overlapping or adjacent segments
 */
function mergeSegments(segments: SponsorSegment[]): SponsorSegment[] {
  if (segments.length === 0) {
    return [];
  }
  
  const merged: SponsorSegment[] = [];
  let current = { ...segments[0] };
  
  for (let i = 1; i < segments.length; i++) {
    const next = segments[i];
    
    // Check if segments overlap or are adjacent (within 0.5 seconds)
    if (next.segment[0] <= current.segment[1] + 0.5) {
      // Merge them
      current.segment[1] = Math.max(current.segment[1], next.segment[1]);
      current.votes = Math.max(current.votes, next.votes);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  
  merged.push(current);
  return merged;
}

/**
 * Format segments for display
 */
export function formatSegments(segments: SponsorSegment[]): string {
  if (segments.length === 0) {
    return 'No segments to skip';
  }
  
  const lines: string[] = [];
  const categoryNames: { [key: string]: string } = {
    sponsor: 'Sponsor',
    intro: 'Intro',
    outro: 'Outro',
    selfpromo: 'Self Promotion',
    interaction: 'Subscribe Reminder',
    music_offtopic: 'Non-Music',
    preview: 'Preview/Recap',
    filler: 'Filler',
    poi_highlight: 'Highlight',
    exclusive_access: 'Exclusive Access'
  };
  
  for (const segment of segments) {
    const start = formatTime(segment.segment[0]);
    const end = formatTime(segment.segment[1]);
    const duration = formatTime(segment.segment[1] - segment.segment[0]);
    const category = categoryNames[segment.category] || segment.category;
    const votes = segment.votes;
    
    lines.push(`${start} - ${end} (${duration}) | ${category} | ${votes} votes`);
  }
  
  return lines.join('\n');
}

function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}
