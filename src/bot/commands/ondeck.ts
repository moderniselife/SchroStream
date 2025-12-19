import type { Message } from 'discord.js-selfbot-v13';
import { getWatchDeck, formatDeckEntry } from '../../data/watch-deck.js';
import { getVideoStreamer, getPlaybackPosition } from '../../stream/video-streamer.js';
import plexClient from '../../plex/client.js';
import { formatDuration } from '../../plex/library.js';

export async function onDeckCommand(message: Message, args: string[]): Promise<void> {
  const deck = getWatchDeck();
  
  if (deck.length === 0) {
    await message.channel.send('📺 **On Deck**\n\nNo recently watched items yet. Start watching something!');
    return;
  }
  
  // If a number is provided, play that item
  if (args[0]) {
    const index = parseInt(args[0], 10);
    if (!isNaN(index) && index >= 1 && index <= deck.length) {
      const entry = deck[index - 1];
      
      if (!message.guild) {
        await message.channel.send('❌ This command can only be used in a server');
        return;
      }
      
      const member = message.guild.members.cache.get(message.author.id);
      const voiceChannel = member?.voice.channel;
      
      if (!voiceChannel) {
        await message.channel.send('❌ You must be in a voice channel to play');
        return;
      }
      
      // Get the media item from Plex
      const mediaItem = await plexClient.getMetadata(entry.ratingKey);
      if (!mediaItem) {
        await message.channel.send('❌ Could not find this item in Plex anymore');
        return;
      }
      
      const streamInfo = await plexClient.getDirectStreamUrl(entry.ratingKey);
      if (!streamInfo) {
        await message.channel.send('❌ Could not get stream URL');
        return;
      }
      
      // Check if there's a saved position
      const savedPosition = getPlaybackPosition(entry.ratingKey);
      let startPosition = 0;
      
      if (savedPosition && savedPosition > 30000) {
        const posStr = formatDuration(savedPosition);
        const durStr = entry.duration ? formatDuration(entry.duration) : '??:??';
        await message.channel.send(`⏪ Resuming from ${posStr} / ${durStr}`);
        startPosition = savedPosition;
      }
      
      let title = entry.title;
      if (entry.type === 'episode' && entry.showTitle) {
        const season = entry.seasonNum ? `S${String(entry.seasonNum).padStart(2, '0')}` : '';
        const episode = entry.episodeNum ? `E${String(entry.episodeNum).padStart(2, '0')}` : '';
        title = `${entry.showTitle} ${season}${episode} - ${entry.title}`;
      }
      
      const duration = entry.duration ? formatDuration(entry.duration) : 'Unknown';
      const statusMsg = await message.channel.send(`📺 **Now Streaming:** ${title}\n⏱️ Duration: ${duration}`);
      
      const videoStreamer = getVideoStreamer();
      videoStreamer.startStream(
        message.guild.id,
        voiceChannel.id,
        mediaItem,
        streamInfo.url,
        startPosition,
        message.author.id
      ).catch((err) => {
        console.error('[OnDeck] Stream error:', err);
      });
      
      return;
    }
  }
  
  // Show the deck
  const lines = deck.map((entry, i) => formatDeckEntry(entry, i));
  
  const response = `📺 **On Deck** (Recently Watched)\n\n${lines.join('\n')}\n\nUse \`!ondeck <number>\` to resume watching`;
  
  await message.channel.send(response);
}
