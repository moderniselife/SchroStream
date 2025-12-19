import type { Message } from 'discord.js-selfbot-v13';
import config from '../../config.js';

export async function helpCommand(message: Message, _args: string[]): Promise<void> {
  const prefix = config.discord.prefix;
  
  const helpText = `
**📺 SchroStream Commands**

**Media Search & Playback:**
\`${prefix}search <query>\` - Search for movies or TV shows
\`${prefix}episodes <number>\` - List seasons/episodes for a show
\`${prefix}play <number>\` - Play a result (S01E01 for shows)
\`${prefix}play <number> S02E05\` - Play specific episode
\`${prefix}random [movie|show]\` - Play random media
\`${prefix}ondeck\` - Show recently watched (resume)
\`${prefix}queue\` - View/manage playback queue
\`${prefix}stop\` - Stop the current stream

**Playback Controls:**
\`${prefix}pause\` - Pause playback (remembers position)
\`${prefix}resume\` - Resume paused playback
\`${prefix}seek <time>\` - Seek to time (e.g., \`1:30:00\` or \`45:00\`)
\`${prefix}ff [time]\` - Skip forward (default: 30s)
\`${prefix}rw [time]\` - Rewind (default: 30s)
\`${prefix}skip\` - Skip to next episode (TV shows only)
\`${prefix}np\` - Show what's currently playing
\`${prefix}volume <0-200>\` - Set volume (default: 100%)

**External Sources:**
\`${prefix}yt <url>\` - Play YouTube/Twitch/etc via yt-dlp
\`${prefix}yts <query>\` - Search YouTube
\`${prefix}ytp <number>\` - Play YouTube search result
\`${prefix}url <url> [title]\` - Play m3u8/stream URL directly

**Example:**
1. \`${prefix}search breaking bad\`
2. \`${prefix}play 1\`
3. Enjoy the stream! 🎬

*Your playback position is saved automatically and persists across restarts.*
  `.trim();

  await message.channel.send(helpText);
}
