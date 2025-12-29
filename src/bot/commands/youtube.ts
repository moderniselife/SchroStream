import type { Message, VoiceChannel } from 'discord.js-selfbot-v13';
import { getVideoStreamer } from '../../stream/video-streamer.js';
import { formatDuration } from '../../plex/library.js';
import { downloadYouTubeVideo, type DownloadProgress } from '../../youtube/downloader.js';

function createProgressBar(percent: number): string {
  const barLength = 20;
  const filledLength = Math.round((percent / 100) * barLength);
  const bar = '█'.repeat(filledLength) + '░'.repeat(barLength - filledLength);
  return `[${bar}] ${percent.toFixed(1)}%`;
}

export async function youtubeCommand(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.channel.send('❌ This command can only be used in a server');
    return;
  }

  const url = args[0];
  if (!url) {
    await message.channel.send(
      '❌ Usage: `!yt <url>`\n' +
      'Supports YouTube, Twitch, Twitter/X, and 1000+ other sites via yt-dlp'
    );
    return;
  }

  const member = message.guild.members.cache.get(message.author.id);
  const voiceChannel = member?.voice.channel as VoiceChannel | undefined;

  if (!voiceChannel) {
    await message.channel.send('❌ You must be in a voice channel to use this command');
    return;
  }

  const statusMsg = await message.channel.send('🔍 Fetching video info...');

  try {
    let downloadComplete = false;
    let currentProgress: DownloadProgress | null = null;

    // Start download with progress tracking
    const downloadPromise = downloadYouTubeVideo(url, {
      onProgress: async (progress: DownloadProgress) => {
        currentProgress = progress;
        const progressBar = createProgressBar(progress.percent);
        
        await statusMsg.edit(
          `📥 **Downloading Video**\n` +
          `${progressBar}\n` +
          `📊 ${progress.speed} | ⏱️ ETA: ${progress.eta}\n` +
          `📁 Total: ${progress.total}\n\n` +
          `*Download will auto-start streaming when complete...*`
        );
      },
      onComplete: async () => {
        downloadComplete = true;
        await statusMsg.edit(
          `📥 **Download Complete!**\n` +
          `✅ Video downloaded successfully\n\n` +
          `🎬 *Starting stream automatically...*`
        );
      },
      onError: async (error: string) => {
        await statusMsg.edit(`❌ Download failed: ${error}`);
      }
    });

    // Wait for download to complete
    const downloadedVideo = await downloadPromise;
    
    if (!downloadedVideo) {
      return; // Error already handled by onError callback
    }

    const videoStreamer = getVideoStreamer();
    
    const mediaItem = {
      ratingKey: `yt-${Date.now()}`,
      key: url,
      title: downloadedVideo.title,
      type: 'movie' as const,
      duration: downloadedVideo.duration,
      thumb: downloadedVideo.thumbnail,
      summary: downloadedVideo.uploader ? `By ${downloadedVideo.uploader}` : undefined,
    };

    const duration = downloadedVideo.duration ? formatDuration(downloadedVideo.duration) : 'Live/Unknown';

    await statusMsg.edit(
      `📺 **Starting:** ${downloadedVideo.title}\n` +
      `${downloadedVideo.uploader ? `👤 ${downloadedVideo.uploader}\n` : ''}` +
      `⏱️ Duration: ${duration}\n` +
      `📥 Playing from local file (no buffering!)\n\n` +
      `*Connecting to voice channel...*`
    );

    // Start streaming the downloaded file
    await videoStreamer.startLocalFile(
      message.guild.id,
      voiceChannel.id,
      mediaItem,
      downloadedVideo.filePath,
      message.author.id
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));

    await statusMsg.edit(
      `📺 **Now Streaming:** ${downloadedVideo.title}\n` +
      `${downloadedVideo.uploader ? `👤 ${downloadedVideo.uploader}\n` : ''}` +
      `⏱️ Duration: ${duration}\n` +
      `📥 Playing from local file (no buffering!)\n` +
      `🎬 Enjoy the show!`
    );
  } catch (error) {
    console.error('[YouTube] Error:', error);
    await statusMsg.edit(`❌ Failed to play: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
