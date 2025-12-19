import type { Message } from 'discord.js-selfbot-v13';
import {
  createAudioResource,
} from '@discordjs/voice';
import streamManager from '../../stream/manager.js';
import { getNextEpisode, formatDuration } from '../../plex/library.js';
import { audioPlayers, voiceConnections } from './play.js';

export async function skipCommand(message: Message, _args: string[]): Promise<void> {
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

  if (state.mediaItem.type !== 'episode') {
    await message.edit('❌ Skip is only available for TV shows');
    return;
  }

  await message.edit('⏭️ Loading next episode...');

  const nextEpisode = await getNextEpisode(state.mediaItem);

  if (!nextEpisode) {
    await message.edit('❌ No next episode available (end of series or season)');
    return;
  }

  const player = audioPlayers.get(guildId);
  const connection = voiceConnections.get(guildId);

  if (!player || !connection) {
    await message.edit('❌ No active audio connection');
    return;
  }

  try {
    const { stream } = await streamManager.play(
      guildId,
      state.channelId,
      nextEpisode
    );

    const resource = createAudioResource(stream as any);
    player.play(resource);

    const season = nextEpisode.parentIndex ? `S${String(nextEpisode.parentIndex).padStart(2, '0')}` : '';
    const episode = nextEpisode.index ? `E${String(nextEpisode.index).padStart(2, '0')}` : '';
    const title = `${nextEpisode.grandparentTitle || ''} ${season}${episode} - ${nextEpisode.title}`;
    const duration = nextEpisode.duration ? formatDuration(nextEpisode.duration) : 'Unknown';

    await message.edit(`⏭️ **Now Playing:** ${title}\n⏱️ Duration: ${duration}`);
  } catch (error) {
    console.error('[Skip] Error:', error);
    await message.edit(`❌ Failed to skip: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
