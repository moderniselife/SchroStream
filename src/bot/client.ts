import { Client } from 'discord.js-selfbot-v13';
import config from '../config.js';
import { handleCommand } from './commands/index.js';
import { initVideoStreamer } from '../stream/video-streamer.js';

export const client = new Client({
  checkUpdate: false,
});

client.on('ready', async () => {
  console.log(`[SchroStream] Logged in as ${client.user?.tag}`);
  console.log(`[SchroStream] Prefix: ${config.discord.prefix}`);
  console.log(`[SchroStream] Owner: ${config.discord.ownerId || client.user?.id} (${config.discord.ownerId ? 'external' : 'self'})`);
  console.log(`[SchroStream] Allowed guilds: ${config.discord.allowedGuilds.length > 0 ? config.discord.allowedGuilds.join(', ') : 'all'}`);
  console.log(`[SchroStream] Video streaming enabled (Go Live)`);
  
  initVideoStreamer(client);
});

client.on('messageCreate', async (message) => {
  const isOwner = config.discord.ownerId 
    ? message.author.id === config.discord.ownerId
    : message.author.id === client.user?.id;

  if (!isOwner) return;

  if (config.discord.allowedGuilds.length > 0 && message.guild) {
    if (!config.discord.allowedGuilds.includes(message.guild.id)) return;
  }

  if (!message.content.startsWith(config.discord.prefix)) return;

  const args = message.content.slice(config.discord.prefix.length).trim().split(/\s+/);
  const commandName = args.shift()?.toLowerCase();

  if (!commandName) return;

  try {
    await handleCommand(commandName, message, args);
  } catch (error) {
    console.error(`[Command Error] ${commandName}:`, error);
    await message.edit(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`).catch(() => {});
  }
});

client.on('error', (error) => {
  console.error('[Discord Error]', error);
});

export async function startBot(): Promise<void> {
  console.log('[SchroStream] Starting bot...');
  await client.login(config.discord.token);
}

export default client;
