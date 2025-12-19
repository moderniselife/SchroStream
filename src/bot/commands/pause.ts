import type { Message } from 'discord.js-selfbot-v13';
import {
  createAudioResource,
} from '@discordjs/voice';
import streamManager from '../../stream/manager.js';
import { audioPlayers, voiceConnections } from './play.js';

export async function pauseCommand(message: Message, _args: string[]): Promise<void> {
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

  const player = audioPlayers.get(guildId);
  const connection = voiceConnections.get(guildId);

  if (!player || !connection) {
    await message.edit('❌ No active audio player');
    return;
  }

  if (state.isPaused) {
    const result = await streamManager.resume(guildId);
    if (result) {
      const resource = createAudioResource(result.stream as any);
      player.play(resource);
      await message.edit('▶️ Playback resumed');
    } else {
      await message.edit('❌ Failed to resume playback');
    }
  } else {
    player.pause();
    await streamManager.pause(guildId);
    await message.edit('⏸️ Playback paused');
  }
}
