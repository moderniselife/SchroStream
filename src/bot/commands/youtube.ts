import type { Message, VoiceChannel } from 'discord.js-selfbot-v13';
import { getVideoStreamer } from '../../stream/video-streamer.js';
import { formatDuration } from '../../plex/library.js';
import { downloadYouTubeVideo } from '../../youtube/downloader.js';

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
    await statusMsg.edit(`📥 **Downloading:** ${url}\n⏳ Using yt-dlp accelerated download...`);

    // Download the video using yt-dlp
    const downloadedVideo = await downloadYouTubeVideo(url);
    if (!downloadedVideo) {
      await statusMsg.edit('❌ Failed to download video. Make sure yt-dlp is installed and the URL is valid.');
      return;
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
      `📥 Downloaded locally for better performance\n\n` +
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
      `📥 Playing from local file (no buffering!)`
    );
  } catch (error) {
    console.error('[YouTube] Error:', error);
    await statusMsg.edit(`❌ Failed to play: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
