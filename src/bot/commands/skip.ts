import type { Message } from 'discord.js-selfbot-v13';
import { getVideoStreamer } from '../../stream/video-streamer.js';
import { getNextEpisode, formatDuration } from '../../plex/library.js';
import plexClient from '../../plex/client.js';

export async function skipCommand(message: Message, _args: string[]): Promise<void> {
  if (!message.guild) {
    await message.channel.send('❌ This command can only be used in a server');
    return;
  }

  const guildId = message.guild.id;
  const videoStreamer = getVideoStreamer();
  const session = videoStreamer.getSession(guildId);

  if (!session) {
    await message.channel.send('❌ Nothing is currently playing');
    return;
  }

  if (session.mediaItem.type !== 'episode') {
    await message.channel.send('❌ Skip is only available for TV shows');
    return;
  }

  const statusMsg = await message.channel.send('⏭️ Loading next episode...');

  const nextEpisode = await getNextEpisode(session.mediaItem);

  if (!nextEpisode) {
    await statusMsg.edit('❌ No next episode available (end of series or season)');
    return;
  }

  try {
    const streamInfo = await plexClient.getDirectStreamUrl(nextEpisode.ratingKey);
    if (!streamInfo) {
      throw new Error('Could not get stream URL for next episode');
    }

    await videoStreamer.startStream(
      guildId,
      session.channelId,
      nextEpisode,
      streamInfo.url,
      0
    );

    const season = nextEpisode.parentIndex ? `S${String(nextEpisode.parentIndex).padStart(2, '0')}` : '';
    const episode = nextEpisode.index ? `E${String(nextEpisode.index).padStart(2, '0')}` : '';
    const title = `${nextEpisode.grandparentTitle || ''} ${season}${episode} - ${nextEpisode.title}`;
    const duration = nextEpisode.duration ? formatDuration(nextEpisode.duration) : 'Unknown';

    await statusMsg.edit(`⏭️ **Now Streaming:** ${title}\n⏱️ Duration: ${duration}`);
  } catch (error) {
    console.error('[Skip] Error:', error);
    await statusMsg.edit(`❌ Failed to skip: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
