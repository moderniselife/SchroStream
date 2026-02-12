import type { Message, VoiceChannel } from 'discord.js-selfbot-v13';
import { getVideoStreamer } from '../../stream/video-streamer.js';
import { formatDuration, parseTimeString } from '../../plex/library.js';
import { downloadYouTubeMusic, findDownloadedMusicByUrl, type MusicDownloadProgress } from '../../youtube/music-downloader.js';
import type { MusicMediaItem } from '../../types/index.js';

function createProgressBar(percent: number): string {
  const barLength = 20;
  const filledLength = Math.round((percent / 100) * barLength);
  const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
  return `[${bar}] ${percent.toFixed(1)}%`;
}

export async function ytMusicCommand(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.channel.send('❌ This command can only be used in a server');
    return;
  }

  const url = args[0];
  if (!url) {
    await message.channel.send(
      '❌ Usage: `!ytm <url> [time]`\n' +
      'Example: `!ytm https://youtu.be/abc123 1:30`\n' +
      'Plays audio with a music visualizer (album art + progress bar)'
    );
    return;
  }

  // Parse optional time argument
  let startTimeMs = 0;
  if (args[1]) {
    const parsed = parseTimeString(args[1]);
    if (parsed !== null) {
      startTimeMs = parsed;
    }
  }

  const member = message.guild.members.cache.get(message.author.id);
  const voiceChannel = member?.voice.channel as VoiceChannel | undefined;

  if (!voiceChannel) {
    await message.channel.send('❌ You must be in a voice channel to use this command');
    return;
  }

  const statusMsg = await message.channel.send('🎵 Fetching music info...');

  // Check if music is already downloaded
  const existingMusic = findDownloadedMusicByUrl(url);
  if (existingMusic) {
    console.log(`[YTMusic] Found existing download for: ${url}`);

    const videoStreamer = getVideoStreamer();

    const mediaItem: MusicMediaItem = {
      ratingKey: `music-${Date.now()}`,
      key: url,
      title: existingMusic.title,
      artist: existingMusic.artist,
      type: 'music',
      duration: existingMusic.duration,
      thumb: existingMusic.thumbnailUrl,
      url: url,
      audioPath: existingMusic.audioPath,
      thumbnailPath: existingMusic.thumbnailPath,
    };

    const duration = existingMusic.duration ? formatDuration(existingMusic.duration) : 'Unknown';

    await statusMsg.edit(
      `🎵 **Now Playing:** ${existingMusic.title}\n` +
      `🎤 ${existingMusic.artist}\n` +
      `⏱️ Duration: ${duration}\n` +
      `📥 Playing from cache (instant!)\n\n` +
      `*Connecting to voice channel...*`
    );

    await videoStreamer.startMusicStream(
      message.guild.id,
      voiceChannel.id,
      mediaItem,
      existingMusic.audioPath,
      existingMusic.thumbnailPath,
      existingMusic.artist,
      message.author.id,
      startTimeMs
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));

    await statusMsg.edit(
      `🎵 **Now Playing:** ${existingMusic.title}\n` +
      `🎤 ${existingMusic.artist}\n` +
      `⏱️ Duration: ${duration}\n` +
      `🎶 Enjoy the music!`
    );

    return;
  }

  try {
    // Download audio + thumbnail
    const downloadedMusic = await downloadYouTubeMusic(url, {
      onProgress: async (progress: MusicDownloadProgress) => {
        const progressBar = createProgressBar(progress.percent);
        try {
          await statusMsg.edit(
            `🎵 **Downloading Audio**\n` +
            `${progressBar}\n` +
            `📊 ${progress.speed} | ⏱️ ETA: ${progress.eta}\n\n` +
            `*Will start playing when complete...*`
          );
        } catch {
          // Ignore update errors
        }
      },
      onComplete: async () => {
        try {
          await statusMsg.edit(
            `🎵 **Download Complete!**\n` +
            `✅ Audio downloaded successfully\n\n` +
            `🎶 *Starting music visualizer...*`
          );
        } catch {
          // Ignore
        }
      },
      onError: async (error: string) => {
        await statusMsg.edit(`❌ Download failed: ${error}`);
      }
    });

    if (!downloadedMusic) {
      return;
    }

    const videoStreamer = getVideoStreamer();

    const mediaItem: MusicMediaItem = {
      ratingKey: `music-${Date.now()}`,
      key: url,
      title: downloadedMusic.title,
      artist: downloadedMusic.artist,
      type: 'music',
      duration: downloadedMusic.duration,
      thumb: downloadedMusic.thumbnailUrl,
      url: url,
      audioPath: downloadedMusic.audioPath,
      thumbnailPath: downloadedMusic.thumbnailPath,
    };

    const duration = downloadedMusic.duration ? formatDuration(downloadedMusic.duration) : 'Unknown';

    await statusMsg.edit(
      `🎵 **Starting:** ${downloadedMusic.title}\n` +
      `🎤 ${downloadedMusic.artist}\n` +
      `⏱️ Duration: ${duration}\n\n` +
      `*Connecting to voice channel...*`
    );

    await videoStreamer.startMusicStream(
      message.guild.id,
      voiceChannel.id,
      mediaItem,
      downloadedMusic.audioPath,
      downloadedMusic.thumbnailPath,
      downloadedMusic.artist,
      message.author.id,
      startTimeMs
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));

    await statusMsg.edit(
      `🎵 **Now Playing:** ${downloadedMusic.title}\n` +
      `🎤 ${downloadedMusic.artist}\n` +
      `⏱️ Duration: ${duration}\n` +
      `🎶 Enjoy the music!`
    );
  } catch (error) {
    console.error('[YTMusic] Error:', error);
    await statusMsg.edit(`❌ Failed to play: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
