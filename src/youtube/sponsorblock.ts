// SponsorBlock API integration for YouTube videos
// API Docs: https://wiki.sponsor.ajay.app/w/API_Docs

export interface SponsorSegment {
  segment: [number, number]; // [startTime, endTime] in seconds
  UUID: string;
  category: string;
  videoDuration: number;
  actionType: string;
  locked: number;
  votes: number;
  description: string;
}

export interface SponsorBlockResult {
  videoId: string;
  segments: SponsorSegment[];
  totalSkipTime: number;
  categories: string[];
}

const SPONSORBLOCK_API = 'https://sponsor.ajay.app/api';

// Categories to skip
export const SKIP_CATEGORIES = [
  'sponsor',      // Paid promotions
  'selfpromo',    // Self-promotion (merch, social media, etc.)
  'interaction',  // Reminders to like, subscribe, etc.
//   'intro',        // Intro animation
//   'outro',        // Outro/credits
  'preview',      // Preview of upcoming content
  'filler',       // Filler content (off-topic tangents)
  // 'music_offtopic' - Excluded as it's for music videos
];

// Category display names
export const CATEGORY_NAMES: Record<string, string> = {
  sponsor: '💰 Sponsor',
  selfpromo: '📢 Self-Promotion',
  interaction: '👆 Interaction Reminder',
//   intro: '🎬 Intro',
//   outro: '🔚 Outro',
  preview: '👀 Preview',
  filler: '💬 Filler',
  music_offtopic: '🎵 Non-Music',
};

// Extract video ID from YouTube URL
export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/, // Direct video ID
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Fetch sponsor segments from SponsorBlock API
export async function fetchSponsorSegments(videoIdOrUrl: string): Promise<SponsorBlockResult | null> {
  const videoId = extractVideoId(videoIdOrUrl) || videoIdOrUrl;
  
  if (!videoId || videoId.length !== 11) {
    console.log('[SponsorBlock] Invalid video ID:', videoId);
    return null;
  }

  try {
    const categoriesParam = JSON.stringify(SKIP_CATEGORIES);
    const url = `${SPONSORBLOCK_API}/skipSegments?videoID=${videoId}&categories=${encodeURIComponent(categoriesParam)}`;
    
    console.log(`[SponsorBlock] Fetching segments for video: ${videoId}`);
    
    const response = await fetch(url);
    
    if (response.status === 404) {
      console.log('[SponsorBlock] No segments found for this video');
      return {
        videoId,
        segments: [],
        totalSkipTime: 0,
        categories: [],
      };
    }
    
    if (!response.ok) {
      console.error('[SponsorBlock] API error:', response.status, response.statusText);
      return null;
    }
    
    const segments: SponsorSegment[] = await response.json();
    
    // Calculate total skip time
    let totalSkipTime = 0;
    const categoriesFound = new Set<string>();
    
    for (const segment of segments) {
      const [start, end] = segment.segment;
      totalSkipTime += end - start;
      categoriesFound.add(segment.category);
    }
    
    console.log(`[SponsorBlock] Found ${segments.length} segments to skip (${totalSkipTime.toFixed(1)}s total)`);
    
    // Log each segment
    for (const segment of segments) {
      const [start, end] = segment.segment;
      const categoryName = CATEGORY_NAMES[segment.category] || segment.category;
      console.log(`[SponsorBlock]   - ${categoryName}: ${formatTime(start)} → ${formatTime(end)} (${(end - start).toFixed(1)}s)`);
    }
    
    return {
      videoId,
      segments,
      totalSkipTime,
      categories: Array.from(categoriesFound),
    };
  } catch (error) {
    console.error('[SponsorBlock] Failed to fetch segments:', error);
    return null;
  }
}

// Format seconds to MM:SS
function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Format sponsor block result for Discord embed
export function formatSponsorBlockEmbed(result: SponsorBlockResult): string {
  if (result.segments.length === 0) {
    return '✅ No sponsor segments found';
  }
  
  const lines = [`🚫 **${result.segments.length} segments removed** (${result.totalSkipTime.toFixed(1)}s saved)`];
  
  for (const segment of result.segments.slice(0, 5)) { // Limit to 5
    const [start, end] = segment.segment;
    const categoryName = CATEGORY_NAMES[segment.category] || segment.category;
    lines.push(`  • ${categoryName}: ${formatTime(start)} → ${formatTime(end)}`);
  }
  
  if (result.segments.length > 5) {
    lines.push(`  • ...and ${result.segments.length - 5} more`);
  }
  
  return lines.join('\n');
}
