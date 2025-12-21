import { Message } from 'discord.js-selfbot-v13';
import { getNetflixClient } from '../../netflix/client.js';

export const name = 'netflix';
export const description = 'Netflix commands - search, play, recommendations';

export async function execute(message: Message, args: string[]): Promise<void> {
  const subcommand = args[0]?.toLowerCase();

  if (!subcommand) {
    await message.reply('**Netflix Commands:**\n' +
      '`!netflix login` - Login to Netflix (opens browser)\n' +
      '`!netflix search <query>` - Search for content\n' +
      '`!netflix recommendations` - Get recommendations\n' +
      '`!netflix play <id>` - Play content by ID');
    return;
  }

  const netflix = getNetflixClient();

  try {
    switch (subcommand) {
      case 'login': {
        await message.reply('🔐 Initializing Netflix browser...');
        await netflix.initialize();
        
        if (!netflix.isLoggedIn()) {
          await message.reply('📱 Please log in to Netflix in the browser window that opened.\nWaiting for login...');
          const success = await netflix.login();
          
          if (success) {
            await message.reply('✅ Netflix login successful!');
          } else {
            await message.reply('❌ Netflix login failed or timed out');
          }
        } else {
          await message.reply('✅ Already logged in to Netflix!');
        }
        break;
      }

      case 'search': {
        const query = args.slice(1).join(' ');
        if (!query) {
          await message.reply('❌ Please provide a search query: `!netflix search <query>`');
          return;
        }

        if (!netflix.isLoggedIn()) {
          await message.reply('❌ Not logged in. Use `!netflix login` first');
          return;
        }

        await message.reply(`🔍 Searching Netflix for: **${query}**...`);
        const results = await netflix.search(query);

        if (results.length === 0) {
          await message.reply('No results found');
          return;
        }

        const resultText = results.map((item, i) => 
          `${i + 1}. **${item.title}** (ID: \`${item.id}\`)`
        ).join('\n');

        await message.reply(`**Search Results:**\n${resultText}\n\nUse \`!netflix play <id>\` to play`);
        break;
      }

      case 'recommendations':
      case 'recs': {
        if (!netflix.isLoggedIn()) {
          await message.reply('❌ Not logged in. Use `!netflix login` first');
          return;
        }

        await message.reply('📺 Getting Netflix recommendations...');
        const results = await netflix.getRecommendations();

        if (results.length === 0) {
          await message.reply('No recommendations found');
          return;
        }

        const resultText = results.slice(0, 10).map((item, i) => 
          `${i + 1}. **${item.title}** (ID: \`${item.id}\`)`
        ).join('\n');

        await message.reply(`**Recommendations:**\n${resultText}\n\nUse \`!netflix play <id>\` to play`);
        break;
      }

      case 'play': {
        const contentId = args[1];
        if (!contentId) {
          await message.reply('❌ Please provide a content ID: `!netflix play <id>`');
          return;
        }

        if (!netflix.isLoggedIn()) {
          await message.reply('❌ Not logged in. Use `!netflix login` first');
          return;
        }

        await message.reply(`▶️ Starting Netflix playback: ${contentId}...`);
        
        // For now, just open the player
        // In production, you'd capture the stream and pipe it to Discord
        const watchUrl = await netflix.play(contentId);
        
        if (watchUrl) {
          await message.reply(`✅ Netflix player opened!\n**Note:** Stream capture for Discord is not yet implemented.\nWatch URL: ${watchUrl}`);
        } else {
          await message.reply('❌ Failed to start playback');
        }
        break;
      }

      case 'close': {
        await netflix.close();
        await message.reply('✅ Netflix browser closed');
        break;
      }

      default:
        await message.reply('❌ Unknown subcommand. Use `!netflix` to see available commands');
    }
  } catch (error) {
    console.error('[Netflix Command] Error:', error);
    await message.reply(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
