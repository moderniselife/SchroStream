import type { Message } from 'discord.js-selfbot-v13';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import { getSearchResult, clearSearchSession } from '../../plex/search.js';
import streamManager from '../../stream/manager.js';
import { formatDuration } from '../../plex/library.js';
import plexClient from '../../plex/client.js';

const audioPlayers = new Map<string, ReturnType<typeof createAudioPlayer>>();
const voiceConnections = new Map<string, ReturnType<typeof joinVoiceChannel>>();

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
      await startStream(message, voiceChannel.id, firstEpisode);
    } else {
      await startStream(message, voiceChannel.id, mediaItem);
    }

    clearSearchSession(message.author.id);
  } catch (error) {
    console.error('[Play] Error:', error);
    await message.edit(`❌ Failed to start stream: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function startStream(
  message: Message,
  channelId: string,
  mediaItem: { ratingKey: string; title: string; duration?: number; type: string; grandparentTitle?: string; parentIndex?: number; index?: number }
): Promise<void> {
  const guildId = message.guild!.id;

  const connection = joinVoiceChannel({
    channelId,
    guildId,
    adapterCreator: message.guild!.voiceAdapterCreator as any,
    selfDeaf: false,
    selfMute: false,
  });

  voiceConnections.set(guildId, connection);

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  } catch {
    connection.destroy();
    voiceConnections.delete(guildId);
    throw new Error('Failed to connect to voice channel');
  }

  const { stream } = await streamManager.play(guildId, channelId, mediaItem as any);

  const audioPlayer = createAudioPlayer();
  audioPlayers.set(guildId, audioPlayer);

  const resource = createAudioResource(stream as any);
  audioPlayer.play(resource);
  connection.subscribe(audioPlayer);

  audioPlayer.on(AudioPlayerStatus.Idle, () => {
    console.log('[Player] Playback finished');
    cleanup(guildId);
  });

  audioPlayer.on('error', (error) => {
    console.error('[Player] Error:', error);
    cleanup(guildId);
  });

  let title = mediaItem.title;
  if (mediaItem.type === 'episode' && mediaItem.grandparentTitle) {
    const season = mediaItem.parentIndex ? `S${String(mediaItem.parentIndex).padStart(2, '0')}` : '';
    const episode = mediaItem.index ? `E${String(mediaItem.index).padStart(2, '0')}` : '';
    title = `${mediaItem.grandparentTitle} ${season}${episode} - ${mediaItem.title}`;
  }

  const duration = mediaItem.duration ? formatDuration(mediaItem.duration) : 'Unknown';
  await message.edit(`▶️ **Now Playing:** ${title}\n⏱️ Duration: ${duration}`);
}

function cleanup(guildId: string): void {
  const player = audioPlayers.get(guildId);
  if (player) {
    player.stop();
    audioPlayers.delete(guildId);
  }

  const connection = voiceConnections.get(guildId);
  if (connection) {
    connection.destroy();
    voiceConnections.delete(guildId);
  }

  streamManager.stop(guildId);
}

export { audioPlayers, voiceConnections, cleanup };
