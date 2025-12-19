import type { Message } from 'discord.js-selfbot-v13';
import { getSearchResult, clearSearchSession } from '../../plex/search.js';
import { getVideoStreamer } from '../../stream/video-streamer.js';
import { formatDuration } from '../../plex/library.js';
import plexClient from '../../plex/client.js';
import type { PlexMediaItem } from '../../types/index.js';

export async function playCommand(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.edit('❌ This command can only be used in a server');
    return;
  }

  const member = message.guild.members.cache.get(message.author.id);
  const voiceChannel = member?.voice.channel;

  if (!voiceChannel) {
    await message.edit('❌ You must be in a voice channel to use this command');
    return;
  }

  const selection = parseInt(args[0], 10);

  if (isNaN(selection) || selection < 1) {
    await message.edit('❌ Usage: `!play <number>` (use `!search` first)');
    return;
  }

  const mediaItem = getSearchResult(message.author.id, selection);

  if (!mediaItem) {
    await message.edit('❌ Invalid selection. Use `!search` to find media first');
    return;
  }

  await message.edit(`🎬 Loading "${mediaItem.title}"...`);

  try {
    if (mediaItem.type === 'show') {
      const episodes = await plexClient.getEpisodes(mediaItem.ratingKey);
      if (episodes.length === 0) {
        await message.edit('❌ No episodes found for this show');
        return;
      }

      const firstEpisode = episodes[0];
      await startVideoStream(message, voiceChannel.id, firstEpisode);
    } else {
      await startVideoStream(message, voiceChannel.id, mediaItem);
    }

    clearSearchSession(message.author.id);
  } catch (error) {
    console.error('[Play] Error:', error);
    await message.edit(`❌ Failed to start stream: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function startVideoStream(
  message: Message,
  channelId: string,
  mediaItem: PlexMediaItem
): Promise<void> {
  const guildId = message.guild!.id;
  const videoStreamer = getVideoStreamer();

  const streamInfo = await plexClient.getDirectStreamUrl(mediaItem.ratingKey);
  if (!streamInfo) {
    throw new Error('Could not get stream URL for media');
  }

  let title = mediaItem.title;
  if (mediaItem.type === 'episode' && mediaItem.grandparentTitle) {
    const season = mediaItem.parentIndex ? `S${String(mediaItem.parentIndex).padStart(2, '0')}` : '';
    const episode = mediaItem.index ? `E${String(mediaItem.index).padStart(2, '0')}` : '';
    title = `${mediaItem.grandparentTitle} ${season}${episode} - ${mediaItem.title}`;
  }

  const duration = mediaItem.duration ? formatDuration(mediaItem.duration) : 'Unknown';
  
  await message.edit(`📺 **Starting Go Live:** ${title}\n⏱️ Duration: ${duration}\n\n*Connecting to voice channel...*`);

  videoStreamer.startStream(
    guildId,
    channelId,
    mediaItem,
    streamInfo.url,
    0
  ).catch((err) => {
    console.error('[Play] Stream error:', err);
  });

  await new Promise((resolve) => setTimeout(resolve, 2000));
  
  await message.edit(`📺 **Now Streaming (Go Live):** ${title}\n⏱️ Duration: ${duration}`);
}

export { startVideoStream };
