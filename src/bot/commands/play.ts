import type { Message } from 'discord.js-selfbot-v13';
import { getSearchResult, clearSearchSession } from '../../plex/search.js';
import { getVideoStreamer, getPlaybackPosition, clearPlaybackPosition } from '../../stream/video-streamer.js';
import { formatDuration } from '../../plex/library.js';
import plexClient from '../../plex/client.js';
import type { PlexMediaItem } from '../../types/index.js';

// Store pending resume prompts (mediaItem ratingKey -> { message, mediaItem, guildId, channelId })
const pendingResume = new Map<string, { userId: string; mediaItem: PlexMediaItem; guildId: string; channelId: string; position: number }>();

export async function playCommand(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.channel.send('❌ This command can only be used in a server');
    return;
  }

  const member = message.guild.members.cache.get(message.author.id);
  const voiceChannel = member?.voice.channel;

  if (!voiceChannel) {
    await message.channel.send('❌ You must be in a voice channel to use this command');
    return;
  }

  // Check for resume confirmation
  const firstArg = args[0]?.toLowerCase();
  if (firstArg === 'resume' || firstArg === 'r') {
    const pending = [...pendingResume.values()].find(p => p.userId === message.author.id);
    if (pending) {
      pendingResume.delete(pending.mediaItem.ratingKey);
      const statusMsg = await message.channel.send(`▶️ Resuming from ${formatDuration(pending.position)}...`);
      await startVideoStream(statusMsg, pending.guildId, pending.channelId, pending.mediaItem, pending.position);
      return;
    }
  }
  
  if (firstArg === 'start' || firstArg === 'new' || firstArg === 'beginning') {
    const pending = [...pendingResume.values()].find(p => p.userId === message.author.id);
    if (pending) {
      pendingResume.delete(pending.mediaItem.ratingKey);
      clearPlaybackPosition(pending.mediaItem.ratingKey);
      const statusMsg = await message.channel.send(`🎬 Starting from beginning...`);
      await startVideoStream(statusMsg, pending.guildId, pending.channelId, pending.mediaItem, 0);
      return;
    }
  }

  const selection = parseInt(args[0], 10);

  if (isNaN(selection) || selection < 1) {
    await message.channel.send('❌ Usage: `!play <number>` (use `!search` first)');
    return;
  }

  const mediaItem = getSearchResult(message.author.id, selection);

  if (!mediaItem) {
    await message.channel.send('❌ Invalid selection. Use `!search` to find media first');
    return;
  }

  try {
    let itemToPlay = mediaItem;
    
    if (mediaItem.type === 'show') {
      const episodes = await plexClient.getEpisodes(mediaItem.ratingKey);
      if (episodes.length === 0) {
        await message.channel.send('❌ No episodes found for this show');
        return;
      }
      itemToPlay = episodes[0];
    }
    
    // Check for saved position
    const savedPosition = getPlaybackPosition(itemToPlay.ratingKey);
    
    if (savedPosition && savedPosition > 60000) { // More than 1 minute
      const duration = itemToPlay.duration || 0;
      const percentWatched = duration > 0 ? Math.round((savedPosition / duration) * 100) : 0;
      
      // Store pending resume
      pendingResume.set(itemToPlay.ratingKey, {
        userId: message.author.id,
        mediaItem: itemToPlay,
        guildId: message.guild!.id,
        channelId: voiceChannel.id,
        position: savedPosition,
      });
      
      // Clear after 30 seconds
      setTimeout(() => pendingResume.delete(itemToPlay.ratingKey), 30000);
      
      let title = itemToPlay.title;
      if (itemToPlay.type === 'episode' && itemToPlay.grandparentTitle) {
        const season = itemToPlay.parentIndex ? `S${String(itemToPlay.parentIndex).padStart(2, '0')}` : '';
        const episode = itemToPlay.index ? `E${String(itemToPlay.index).padStart(2, '0')}` : '';
        title = `${itemToPlay.grandparentTitle} ${season}${episode}`;
      }
      
      await message.channel.send(
        `⏸️ **Resume Playback?**\n` +
        `You were watching **${title}** at ${formatDuration(savedPosition)} (${percentWatched}%)\n\n` +
        `\`!play resume\` - Continue where you left off\n` +
        `\`!play start\` - Start from beginning`
      );
      return;
    }

    const statusMsg = await message.channel.send(`🎬 Loading "${mediaItem.title}"...`);
    await startVideoStream(statusMsg, message.guild!.id, voiceChannel.id, itemToPlay, 0);

    clearSearchSession(message.author.id);
  } catch (error) {
    console.error('[Play] Error:', error);
    await message.channel.send(`❌ Failed to start stream: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function startVideoStream(
  statusMsg: Message,
  guildId: string,
  channelId: string,
  mediaItem: PlexMediaItem,
  startTimeMs = 0
): Promise<void> {
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
  
  await statusMsg.edit(`📺 **Starting Go Live:** ${title}\n⏱️ Duration: ${duration}\n\n*Connecting to voice channel...*`);

  videoStreamer.startStream(
    guildId,
    channelId,
    mediaItem,
    streamInfo.url,
    startTimeMs
  ).catch((err) => {
    console.error('[Play] Stream error:', err);
  });

  await new Promise((resolve) => setTimeout(resolve, 2000));
  
  await statusMsg.edit(`📺 **Now Streaming (Go Live):** ${title}\n⏱️ Duration: ${duration}`);
}

export { startVideoStream };
