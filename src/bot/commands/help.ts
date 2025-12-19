import type { Message } from 'discord.js-selfbot-v13';
import config from '../../config.js';

export async function helpCommand(message: Message, _args: string[]): Promise<void> {
  const prefix = config.discord.prefix;
  
  const helpText = `
**📺 SchroStream Commands**

**Media Search & Playback:**
\`${prefix}search <query>\` - Search for movies or TV shows
\`${prefix}play <number>\` - Play a result from your search
\`${prefix}stop\` - Stop the current stream

**Playback Controls:**
\`${prefix}pause\` - Pause/resume playback
\`${prefix}seek <time>\` - Seek to time (e.g., \`1:30:00\` or \`45:00\`)
\`${prefix}skip\` - Skip to next episode (TV shows only)
\`${prefix}np\` - Show what's currently playing

**Example:**
1. \`${prefix}search breaking bad\`
2. \`${prefix}play 1\`
3. Enjoy the stream! 🎬

*Note: You must be in a voice channel to start playback.*
  `.trim();

  await message.channel.send(helpText);
}
