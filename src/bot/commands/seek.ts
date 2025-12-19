import type { Message } from 'discord.js-selfbot-v13';
import { createAudioResource } from '@discordjs/voice';
import streamManager from '../../stream/manager.js';
import { parseTimeString, formatDuration } from '../../plex/library.js';
import { audioPlayers } from './play.js';

export async function seekCommand(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.edit('❌ This command can only be used in a server');
    return;
  }

  const timeArg = args[0];
  if (!timeArg) {
    await message.edit('❌ Usage: `!seek <time>` (e.g., `!seek 1:30:00` or `!seek 45:00`)');
    return;
  }

  const guildId = message.guild.id;
  const state = streamManager.getState(guildId);

  if (!state) {
    await message.edit('❌ Nothing is currently playing');
    return;
  }

  const timeMs = parseTimeString(timeArg);

  if (timeMs === null) {
    await message.edit('❌ Invalid time format. Use `HH:MM:SS`, `MM:SS`, or seconds');
    return;
  }

  const player = audioPlayers.get(guildId);

  if (!player) {
    await message.edit('❌ No active audio player');
    return;
  }

  await message.edit(`⏩ Seeking to ${formatDuration(timeMs)}...`);

  const result = await streamManager.seek(guildId, timeMs);

  if (result) {
    const resource = createAudioResource(result.stream as any);
    player.play(resource);
    await message.edit(`⏩ Seeked to ${formatDuration(timeMs)}`);
  } else {
    await message.edit('❌ Failed to seek');
  }
}
