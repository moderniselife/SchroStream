import type { Message } from 'discord.js-selfbot-v13';
import { getVideoStreamer, getPlaybackPosition } from '../../stream/video-streamer.js';
import { formatDuration } from '../../plex/library.js';
import plexClient from '../../plex/client.js';
import type { PlexMediaItem } from '../../types/index.js';

export async function randomCommand(message: Message, args: string[]): Promise<void> {
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

  const type = args[0]?.toLowerCase() || 'any';
  
  if (!['movie', 'show', 'any'].includes(type)) {
    await message.channel.send('❌ Usage: `!random [movie|show|any]`\n\nExamples:\n- `!random` - Any random media\n- `!random movie` - Random movie\n- `!random show` - Random TV show episode');
    return;
  }

  await message.channel.send(`🎲 Finding a random ${type === 'any' ? 'movie or show' : type}...`);

  try {
    const libraries = await plexClient.getLibraries();
    let targetLibraries = libraries;
    
    if (type === 'movie') {
      targetLibraries = libraries.filter(lib => lib.type === 'movie');
    } else if (type === 'show') {
      targetLibraries = libraries.filter(lib => lib.type === 'show');
    }

    if (targetLibraries.length === 0) {
      await message.channel.send(`❌ No ${type} libraries found`);
      return;
    }

    // Pick a random library
    const randomLibrary = targetLibraries[Math.floor(Math.random() * targetLibraries.length)];
    
    // Get all items from the library
    const items = await plexClient.getLibraryItems(randomLibrary.key);
    
    if (items.length === 0) {
      await message.channel.send(`❌ No items found in library`);
      return;
    }

    // Pick a random item
    let randomItem = items[Math.floor(Math.random() * items.length)];
    let itemToPlay: PlexMediaItem = randomItem;

    // If it's a show, pick a random episode
    if (randomItem.type === 'show') {
      const episodes = await plexClient.getEpisodes(randomItem.ratingKey);
      if (episodes.length === 0) {
        await message.channel.send(`❌ No episodes found for ${randomItem.title}`);
        return;
      }
      itemToPlay = episodes[Math.floor(Math.random() * episodes.length)];
    }

    // Get stream URL
    const streamInfo = await plexClient.getDirectStreamUrl(itemToPlay.ratingKey);
    if (!streamInfo) {
      await message.channel.send('❌ Could not get stream URL');
      return;
    }

    // Format title
    let title = itemToPlay.title;
    if (itemToPlay.type === 'episode' && itemToPlay.grandparentTitle) {
      const season = itemToPlay.parentIndex ? `S${String(itemToPlay.parentIndex).padStart(2, '0')}` : '';
      const episode = itemToPlay.index ? `E${String(itemToPlay.index).padStart(2, '0')}` : '';
      title = `${itemToPlay.grandparentTitle} ${season}${episode} - ${itemToPlay.title}`;
    }

    const duration = itemToPlay.duration ? formatDuration(itemToPlay.duration) : 'Unknown';
    
    const statusMsg = await message.channel.send(`🎲 **Random Pick:** ${title}\n⏱️ Duration: ${duration}\n\n*Connecting to voice channel...*`);

    const videoStreamer = getVideoStreamer();
    videoStreamer.startStream(
      message.guild.id,
      voiceChannel.id,
      itemToPlay,
      streamInfo.url,
      0
    ).catch((err) => {
      console.error('[Random] Stream error:', err);
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));
    
    await statusMsg.edit(`🎲 **Now Streaming (Random):** ${title}\n⏱️ Duration: ${duration}`);

  } catch (error) {
    console.error('[Random] Error:', error);
    await message.channel.send(`❌ Failed to play random media: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
