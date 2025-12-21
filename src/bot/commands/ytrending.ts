import type { Message } from 'discord.js-selfbot-v13';
import { spawn } from 'child_process';

interface YouTubeSearchResult {
  id: string;
  title: string;
  duration: string;
  channel: string;
  url: string;
}

const trendingCache = new Map<string, { results: YouTubeSearchResult[], timestamp: number, category: string }>();
const CACHE_DURATION = 10 * 60 * 1000; // 10 minutes

const CATEGORY_URLS: Record<string, string> = {
  default: 'https://www.youtube.com/feed/trending',
  music: 'https://www.youtube.com/feed/trending?bp=4gIuCggvbS8wNGZrbmIyUgIIAzABOAFAAUgBUAFYAWAAaAGqAQtUcmVuZGluZyBub3c%3D',
  gaming: 'https://www.youtube.com/feed/trending?bp=4gIuCggvbS8wNGZrbmIyUgIIAzABOAFAAUgBUAFYAWAAaAGqAQtUcmVuZGluZyBub3c%3D',
  news: 'https://www.youtube.com/feed/trending?bp=4gIuCggvbS8wNGZrbmIyUgIIAzABOAFAAUgBUAFYAWAAaAGqAQtUcmVuZGluZyBub3c%3D',
  movies: 'https://www.youtube.com/feed/trending?bp=4gIuCggvbS8wNGZrbmIyUgIIAzABOAFAAUgBUAFYAWAAaAGqAQtUcmVuZGluZyBub3c%3D',
  sports: 'https://www.youtube.com/feed/trending?bp=4gIuCggvbS8wNGZrbmIyUgIIAzABOAFAAUgBUAFYAWAAaAGqAQtUcmVuZGluZyBub3c%3D',
  learning: 'https://www.youtube.com/feed/trending?bp=4gIuCggvbS8wNGZrbmIyUgIIAzABOAFAAUgBUAFYAWAAaAGqAQtUcmVuZGluZyBub3c%3D',
  tech: 'https://www.youtube.com/feed/trending?bp=4gIuCggvbS8wNGZrbmIyUgIIAzABOAFAAUgBUAFYAWAAaAGqAQtUcmVuZGluZyBub3c%3D',
};

const FALLBACK_CHANNELS = {
  music: [
    'https://www.youtube.com/@music',
    'https://www.youtube.com/@billboard',
    'https://www.youtube.com/@Spotify',
  ],
  gaming: [
    'https://www.youtube.com/@YouTubeGaming',
    'https://www.youtube.com/@IGN',
    'https://www.youtube.com/@GameSpot',
  ],
  news: [
    'https://www.youtube.com/@BBCNews',
    'https://www.youtube.com/@CNN',
    'https://www.youtube.com/@Reuters',
  ],
  tech: [
    'https://www.youtube.com/@MKBHD',
    'https://www.youtube.com/@LinusTechTips',
    'https://www.youtube.com/@UnboxTherapy',
  ],
  default: [
    'https://www.youtube.com/@MrBeast',
    'https://www.youtube.com/@pewdiepie',
    'https://www.youtube.com/@DudePerfect',
  ],
};

async function getTrendingVideos(category = 'default', limit = 10): Promise<YouTubeSearchResult[]> {
  // Try trending feed first
  const categoryKey = category as keyof typeof CATEGORY_URLS;
  const trendingUrl = CATEGORY_URLS[categoryKey] || CATEGORY_URLS.default;
  
  const results = await fetchFromUrl(trendingUrl, limit);
  
  // If trending feed fails or returns no results, try fallback channels
  if (results.length === 0) {
    const categoryKey = category as keyof typeof FALLBACK_CHANNELS;
    const fallbackChannelUrls = FALLBACK_CHANNELS[categoryKey] || FALLBACK_CHANNELS.default;
    
    for (const channelUrl of fallbackChannelUrls) {
      const channelResults = await fetchFromUrl(channelUrl, Math.ceil(limit / fallbackChannelUrls.length));
      results.push(...channelResults);
      if (results.length >= limit) break;
    }
  }
  
  return results.slice(0, limit);
}

async function fetchFromUrl(url: string, limit: number): Promise<YouTubeSearchResult[]> {
  // First get video IDs with flat playlist
  const videoIds = await new Promise<string[]>((resolve) => {
    const ytdlp = spawn('yt-dlp', [
      '--flat-playlist',
      '--no-warnings',
      '-I', `1:${limit}`,
      '--get-id',
      url
    ]);

    let output = '';
    let error = '';

    ytdlp.stdout.on('data', (data) => {
      output += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      error += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code !== 0 || !output) {
        console.error('[YouTubeTrending] yt-dlp error:', error);
        resolve([]);
        return;
      }

      const ids = output.trim().split('\n').filter(line => line.trim());
      resolve(ids);
    });

    ytdlp.on('error', (err) => {
      console.error('[YouTubeTrending] yt-dlp spawn error:', err);
      resolve([]);
    });
  });

  if (videoIds.length === 0) return [];

  // Now fetch full metadata for each video in parallel
  const metadataPromises = videoIds.map(id => 
    new Promise<YouTubeSearchResult | null>((resolve) => {
      const ytdlp = spawn('yt-dlp', [
        '--dump-json',
        '--no-warnings',
        `https://www.youtube.com/watch?v=${id}`
      ]);

      let output = '';
      let error = '';

      ytdlp.stdout.on('data', (data) => {
        output += data.toString();
      });

      ytdlp.stderr.on('data', (data) => {
        error += data.toString();
      });

      ytdlp.on('close', (code) => {
        if (code !== 0 || !output) {
          resolve(null);
          return;
        }

        try {
          const info = JSON.parse(output.trim());
          resolve({
            id: info.id,
            title: info.title || 'Unknown',
            duration: formatDuration(info.duration),
            channel: info.channel || info.uploader || info.uploader_id || 'Unknown',
            url: info.url || `https://www.youtube.com/watch?v=${info.id}`,
          });
        } catch (e) {
          resolve(null);
        }
      });

      ytdlp.on('error', () => {
        resolve(null);
      });
    })
  );

  const metadataResults = await Promise.all(metadataPromises);
  const results = metadataResults.filter((r): r is YouTubeSearchResult => r !== null);

  return results;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return 'Live/Unknown';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function getTrendingResult(userId: string, index: number): YouTubeSearchResult | null {
  const cached = trendingCache.get(userId);
  if (!cached || Date.now() - cached.timestamp > CACHE_DURATION) {
    return null;
  }
  return cached.results[index - 1] || null;
}

export async function ytrendingCommand(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.channel.send('❌ This command can only be used in a server');
    return;
  }

  const category = args[0]?.toLowerCase() || 'default';
  const validCategories = Object.keys(CATEGORY_URLS);
  
  if (!validCategories.includes(category)) {
    await message.channel.send(
      `❌ Invalid category. Valid categories are: ${validCategories.join(', ')}\n` +
      `Usage: \`!ytrending [category]\`\n` +
      `Example: \`!ytrending music\`\n\n` +
      `Then use \`!ytp <number>\` to play a result`
    );
    return;
  }

  const statusMsg = await message.channel.send(`🔥 Fetching trending ${category === 'default' ? 'videos' : category + ' videos'}...`);

  try {
    const results = await getTrendingVideos(category, 10);

    if (results.length === 0) {
      await statusMsg.edit('❌ No trending videos found. Try again later or a different category.');
      return;
    }

    // Cache results
    trendingCache.set(message.author.id, {
      results,
      timestamp: Date.now(),
      category,
    });

    const resultLines = results.map((r, i) => 
      `**${i + 1}.** ${r.title}\n   └ ${r.channel} • ${r.duration}`
    );

    await statusMsg.edit(
      `🔥 **Trending ${category === 'default' ? 'Videos' : category.charAt(0).toUpperCase() + category.slice(1)}:**\n\n` +
      resultLines.join('\n\n') +
      `\n\n*Use \`!ytp <number>\` to play a result*`
    );
  } catch (error) {
    console.error('[YouTubeTrending] Error:', error);
    await statusMsg.edit(`❌ Failed to fetch trending videos: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
