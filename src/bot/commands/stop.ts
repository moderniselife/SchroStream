import type { Message } from 'discord.js-selfbot-v13';
import { cleanup } from './play.js';
import streamManager from '../../stream/manager.js';

export async function stopCommand(message: Message, _args: string[]): Promise<void> {
  if (!message.guild) {
    await message.edit('❌ This command can only be used in a server');
    return;
  }

  const guildId = message.guild.id;
  const state = streamManager.getState(guildId);

  if (!state) {
    await message.edit('❌ Nothing is currently playing');
    return;
  }

  cleanup(guildId);
  await message.edit('⏹️ Playback stopped');
}
