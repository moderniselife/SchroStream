import type { Message } from 'discord.js-selfbot-v13';
import { 
  addToQueue, 
  removeFromQueue, 
  getQueue, 
  clearQueue, 
  formatQueueEntry,
  peekQueue,
  popQueue 
} from '../../data/queue.js';
import { getSearchResult } from '../../plex/search.js';
import { getVideoStreamer, getPlaybackPosition } from '../../stream/video-streamer.js';
import plexClient from '../../plex/client.js';
import { formatDuration } from '../../plex/library.js';

export async function queueCommand(message: Message, args: string[]): Promise<void> {
  const subCommand = args[0]?.toLowerCase();
  
  // !queue or !queue list - show queue
  if (!subCommand || subCommand === 'list' || subCommand === 'show') {
    const queue = getQueue();
    
    if (queue.length === 0) {
      await message.channel.send('📋 **Queue**\n\nThe queue is empty. Use `!queue add <search number>` to add items.');
      return;
    }
    
    const lines = queue.map((entry, i) => formatQueueEntry(entry, i));
    const response = `📋 **Queue** (${queue.length} items)\n\n${lines.join('\n')}\n\n**Commands:**\n\`!queue add <number>\` - Add from search\n\`!queue remove <number>\` - Remove from queue\n\`!queue clear\` - Clear queue\n\`!queue play\` - Play next in queue`;
    
    await message.channel.send(response);
    return;
  }
  
  // !queue add <number> - add from search results
  if (subCommand === 'add') {
    const num = parseInt(args[1], 10);
    if (isNaN(num)) {
      await message.channel.send('❌ Usage: `!queue add <search number>`');
      return;
    }
    
    const mediaItem = getSearchResult(message.author.id, num);
    if (!mediaItem) {
      await message.channel.send('❌ Invalid selection. Search for something first with `!search`');
      return;
    }
    
    // If it's a show, we need to add an episode
    if (mediaItem.type === 'show') {
      await message.channel.send('❌ Cannot add a show to queue. Use `!play <number> S01E01` format to select an episode first, or search for the specific episode.');
      return;
    }
    
    const added = addToQueue(mediaItem, message.author.id);
    
    if (!added) {
      await message.channel.send('❌ This item is already in the queue');
      return;
    }
    
    let title = mediaItem.title;
    if (mediaItem.type === 'episode' && mediaItem.grandparentTitle) {
      const season = mediaItem.parentIndex ? `S${String(mediaItem.parentIndex).padStart(2, '0')}` : '';
      const episode = mediaItem.index ? `E${String(mediaItem.index).padStart(2, '0')}` : '';
      title = `${mediaItem.grandparentTitle} ${season}${episode} - ${mediaItem.title}`;
    }
    
    const queue = getQueue();
    await message.channel.send(`✅ Added to queue (#${queue.length}): **${title}**`);
    return;
  }
  
  // !queue remove <number> - remove from queue
  if (subCommand === 'remove' || subCommand === 'rm' || subCommand === 'delete') {
    const num = parseInt(args[1], 10);
    if (isNaN(num)) {
      await message.channel.send('❌ Usage: `!queue remove <queue number>`');
      return;
    }
    
    const removed = removeFromQueue(num);
    
    if (!removed) {
      await message.channel.send('❌ Invalid queue number');
      return;
    }
    
    let title = removed.title;
    if (removed.type === 'episode' && removed.showTitle) {
      const season = removed.seasonNum ? `S${String(removed.seasonNum).padStart(2, '0')}` : '';
      const episode = removed.episodeNum ? `E${String(removed.episodeNum).padStart(2, '0')}` : '';
      title = `${removed.showTitle} ${season}${episode} - ${removed.title}`;
    }
    
    await message.channel.send(`🗑️ Removed from queue: **${title}**`);
    return;
  }
  
  // !queue clear - clear the queue
  if (subCommand === 'clear') {
    const count = clearQueue();
    await message.channel.send(`🗑️ Cleared ${count} items from the queue`);
    return;
  }
  
  // !queue play or !queue next - play next in queue
  if (subCommand === 'play' || subCommand === 'next') {
    if (!message.guild) {
      await message.channel.send('❌ This command can only be used in a server');
      return;
    }
    
    const member = message.guild.members.cache.get(message.author.id);
    const voiceChannel = member?.voice.channel;
    
    if (!voiceChannel) {
      await message.channel.send('❌ You must be in a voice channel');
      return;
    }
    
    const next = popQueue();
    
    if (!next) {
      await message.channel.send('❌ Queue is empty');
      return;
    }
    
    // Get stream URL
    const streamInfo = await plexClient.getDirectStreamUrl(next.ratingKey);
    if (!streamInfo) {
      await message.channel.send('❌ Could not get stream URL');
      return;
    }
    
    // Get full media item
    const mediaItem = await plexClient.getMetadata(next.ratingKey);
    if (!mediaItem) {
      await message.channel.send('❌ Could not find this item in Plex');
      return;
    }
    
    let title = next.title;
    if (next.type === 'episode' && next.showTitle) {
      const season = next.seasonNum ? `S${String(next.seasonNum).padStart(2, '0')}` : '';
      const episode = next.episodeNum ? `E${String(next.episodeNum).padStart(2, '0')}` : '';
      title = `${next.showTitle} ${season}${episode} - ${next.title}`;
    }
    
    const duration = next.duration ? formatDuration(next.duration) : 'Unknown';
    const remaining = getQueue().length;
    
    await message.channel.send(`📋 **Playing from Queue:** ${title}\n⏱️ Duration: ${duration}\n📋 ${remaining} items remaining in queue`);
    
    const videoStreamer = getVideoStreamer();
    videoStreamer.startStream(
      message.guild.id,
      voiceChannel.id,
      mediaItem,
      streamInfo.url,
      0,
      message.author.id
    ).catch((err) => {
      console.error('[Queue] Stream error:', err);
    });
    
    return;
  }
  
  // Unknown subcommand
  await message.channel.send('❌ Unknown queue command. Use `!queue`, `!queue add <n>`, `!queue remove <n>`, `!queue clear`, or `!queue play`');
}
