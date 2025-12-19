import type { Message } from 'discord.js-selfbot-v13';
import { searchMedia, formatSearchResults } from '../../plex/search.js';

export async function searchCommand(message: Message, args: string[]): Promise<void> {
  const query = args.join(' ');

  if (!query) {
    await message.edit('❌ Usage: `!search <query>`');
    return;
  }

  await message.edit(`🔍 Searching for "${query}"...`);

  const results = await searchMedia(query, message.author.id);

  if (results.length === 0) {
    await message.edit(`❌ No results found for "${query}"`);
    return;
  }

  const formatted = formatSearchResults(results);
  await message.edit(`🎬 **Search Results for "${query}":**\n\n${formatted}\n\n*Use \`!play <number>\` to start streaming*`);
}
