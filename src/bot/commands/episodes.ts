import type { Message } from 'discord.js-selfbot-v13';
import { getSearchResult } from '../../plex/search.js';
import plexClient from '../../plex/client.js';

export async function episodesCommand(message: Message, args: string[]): Promise<void> {
  const selection = parseInt(args[0], 10);

  if (isNaN(selection) || selection < 1) {
    await message.channel.send('❌ Usage: `!episodes <number>` (use `!search` first to find a show)');
    return;
  }

  const mediaItem = getSearchResult(message.author.id, selection);

  if (!mediaItem) {
    await message.channel.send('❌ Invalid selection. Use `!search` to find media first');
    return;
  }

  if (mediaItem.type !== 'show') {
    await message.channel.send(`❌ "${mediaItem.title}" is not a TV show`);
    return;
  }

  const statusMsg = await message.channel.send(`📺 Loading episodes for "${mediaItem.title}"...`);

  try {
    const episodes = await plexClient.getEpisodes(mediaItem.ratingKey);
    
    if (episodes.length === 0) {
      await statusMsg.edit('❌ No episodes found for this show');
      return;
    }

    // Group by season
    const seasons = new Map<number, typeof episodes>();
    for (const ep of episodes) {
      const seasonNum = ep.parentIndex || 0;
      if (!seasons.has(seasonNum)) {
        seasons.set(seasonNum, []);
      }
      seasons.get(seasonNum)!.push(ep);
    }

    // Build output
    const lines: string[] = [`**📺 ${mediaItem.title}** (${mediaItem.year || 'N/A'})\n`];
    
    // Sort seasons
    const sortedSeasons = [...seasons.keys()].sort((a, b) => a - b);
    
    for (const seasonNum of sortedSeasons) {
      const seasonEpisodes = seasons.get(seasonNum)!;
      const seasonLabel = seasonNum === 0 ? 'Specials' : `Season ${seasonNum}`;
      
      lines.push(`**${seasonLabel}** (${seasonEpisodes.length} episodes)`);
      
      // List episodes (limit to avoid message too long)
      const epList = seasonEpisodes
        .sort((a, b) => (a.index || 0) - (b.index || 0))
        .slice(0, 26) // Max 26 per season to avoid message limit
        .map(ep => {
          const epNum = ep.index ? `E${String(ep.index).padStart(2, '0')}` : '';
          return `  ${epNum} - ${ep.title}`;
        });
      
      lines.push(epList.join('\n'));
      
      if (seasonEpisodes.length > 26) {
        lines.push(`  *...and ${seasonEpisodes.length - 26} more*`);
      }
      
      lines.push('');
    }

    lines.push(`\n*Use \`!play ${selection} S01E01\` to play a specific episode*`);

    // Split if too long
    const output = lines.join('\n');
    if (output.length > 1900) {
      // Send season summary only
      const summary = [`**📺 ${mediaItem.title}** (${mediaItem.year || 'N/A'})\n`];
      for (const seasonNum of sortedSeasons) {
        const seasonEpisodes = seasons.get(seasonNum)!;
        const seasonLabel = seasonNum === 0 ? 'Specials' : `Season ${seasonNum}`;
        const firstEp = seasonEpisodes[0];
        const lastEp = seasonEpisodes[seasonEpisodes.length - 1];
        summary.push(`**${seasonLabel}**: ${seasonEpisodes.length} episodes (E${String(firstEp.index || 1).padStart(2, '0')} - E${String(lastEp.index || seasonEpisodes.length).padStart(2, '0')})`);
      }
      summary.push(`\n*Total: ${episodes.length} episodes*`);
      summary.push(`*Use \`!play ${selection} S01E01\` to play a specific episode*`);
      await statusMsg.edit(summary.join('\n'));
    } else {
      await statusMsg.edit(output);
    }
  } catch (error) {
    console.error('[Episodes] Error:', error);
    await statusMsg.edit(`❌ Failed to load episodes: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
