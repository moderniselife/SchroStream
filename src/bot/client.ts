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
  
  if (config.discord.allowedUsers.length > 0) {
    console.log(`[SchroStream] Allowed users: ${config.discord.allowedUsers.join(', ')}`);
  } else {
    console.log(`[SchroStream] Allowed users: ${client.user?.id} (self only)`);
  }
  
  if (config.discord.allowedRoles.length > 0) {
    console.log(`[SchroStream] Allowed roles: ${config.discord.allowedRoles.join(', ')}`);
  }
  
  console.log(`[SchroStream] Allowed guilds: ${config.discord.allowedGuilds.length > 0 ? config.discord.allowedGuilds.join(', ') : 'all'}`);
  console.log(`[SchroStream] Video streaming enabled (Go Live)`);
  
  initVideoStreamer(client);
});

function hasPermission(message: import('discord.js-selfbot-v13').Message): boolean {
  // Always allow the bot's own account
  if (message.author.id === client.user?.id) return true;
  
  // Check if user is in the allowed users list
  if (config.discord.allowedUsers.length > 0) {
    if (config.discord.allowedUsers.includes(message.author.id)) return true;
  }
  
  // Check if user has any of the allowed roles (only in guilds)
  if (config.discord.allowedRoles.length > 0 && message.guild && message.member) {
    const memberRoles = message.member.roles.cache;
    const hasAllowedRole = config.discord.allowedRoles.some(roleId => memberRoles.has(roleId));
    if (hasAllowedRole) return true;
  }
  
  // If no users or roles configured, only bot account can use
  return config.discord.allowedUsers.length === 0 && config.discord.allowedRoles.length === 0;
}

client.on('messageCreate', async (message) => {
  // Check user permissions
  if (!hasPermission(message)) return;

  // Check guild restrictions
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
    await message.channel.send(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`).catch(() => {});
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
