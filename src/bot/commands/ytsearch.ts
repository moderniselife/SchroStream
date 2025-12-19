import type { Message } from 'discord.js-selfbot-v13';
import { spawn } from 'child_process';

interface YouTubeSearchResult {
  id: string;
  title: string;
  duration: string;
  channel: string;
  url: string;
}

const searchCache = new Map<string, { results: YouTubeSearchResult[], timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function searchYouTube(query: string, limit = 10): Promise<YouTubeSearchResult[]> {
  return new Promise((resolve) => {
    const ytdlp = spawn('yt-dlp', [
      '--dump-json',
      '--flat-playlist',
      '--no-warnings',
      '-I', `1:${limit}`,
      `ytsearch${limit}:${query}`
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
        console.error('[YouTubeSearch] yt-dlp error:', error);
        resolve([]);
        return;
      }

      try {
        const results: YouTubeSearchResult[] = [];
        const lines = output.trim().split('\n');
        
        for (const line of lines) {
          if (!line.trim()) continue;
          const info = JSON.parse(line);
          results.push({
            id: info.id,
            title: info.title || 'Unknown',
            duration: formatDuration(info.duration),
            channel: info.channel || info.uploader || 'Unknown',
            url: info.url || `https://www.youtube.com/watch?v=${info.id}`,
          });
        }
        
        resolve(results);
      } catch (e) {
        console.error('[YouTubeSearch] Failed to parse results:', e);
        resolve([]);
      }
    });

    ytdlp.on('error', (err) => {
      console.error('[YouTubeSearch] yt-dlp spawn error:', err);
      resolve([]);
    });
  });
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

export function getYouTubeSearchResult(userId: string, index: number): YouTubeSearchResult | null {
  const cached = searchCache.get(userId);
  if (!cached || Date.now() - cached.timestamp > CACHE_DURATION) {
    return null;
  }
  return cached.results[index - 1] || null;
}

export async function ytSearchCommand(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.channel.send('❌ This command can only be used in a server');
    return;
  }

  const query = args.join(' ');
  if (!query) {
    await message.channel.send(
      '❌ Usage: `!yts <search query>`\n' +
      'Example: `!yts never gonna give you up`\n\n' +
      'Then use `!ytp <number>` to play a result'
    );
    return;
  }

  const statusMsg = await message.channel.send(`🔍 Searching YouTube for "${query}"...`);

  try {
    const results = await searchYouTube(query, 10);

    if (results.length === 0) {
      await statusMsg.edit('❌ No results found. Try a different search query.');
      return;
    }

    // Cache results
    searchCache.set(message.author.id, {
      results,
      timestamp: Date.now(),
    });

    const resultLines = results.map((r, i) => 
      `**${i + 1}.** ${r.title}\n   └ ${r.channel} • ${r.duration}`
    );

    await statusMsg.edit(
      `🎬 **YouTube Search Results:**\n\n` +
      resultLines.join('\n\n') +
      `\n\n*Use \`!ytp <number>\` to play a result*`
    );
  } catch (error) {
    console.error('[YouTubeSearch] Error:', error);
    await statusMsg.edit(`❌ Search failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function ytPlayCommand(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.channel.send('❌ This command can only be used in a server');
    return;
  }

  const selection = parseInt(args[0], 10);
  if (isNaN(selection) || selection < 1) {
    await message.channel.send('❌ Usage: `!ytp <number>` (use `!yts` to search first)');
    return;
  }

  const result = getYouTubeSearchResult(message.author.id, selection);
  if (!result) {
    await message.channel.send('❌ Invalid selection or search expired. Use `!yts` to search first.');
    return;
  }

  // Import and call youtubeCommand with the URL
  const { youtubeCommand } = await import('./youtube.js');
  await youtubeCommand(message, [result.url]);
}
