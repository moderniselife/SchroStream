import type { Message, VoiceChannel } from 'discord.js-selfbot-v13';
import { getVideoStreamer } from '../../stream/video-streamer.js';
import { spawn } from 'child_process';
import { formatDuration } from '../../plex/library.js';

interface YouTubeInfo {
  title: string;
  duration: number;
  url: string;
  thumbnail?: string;
  uploader?: string;
}

async function getYouTubeInfo(url: string): Promise<YouTubeInfo | null> {
  return new Promise((resolve) => {
    const ytdlp = spawn('yt-dlp', [
      '--dump-json',
      '--no-playlist',
      '--no-warnings',
      url
    ]);

    let output = '';
    let error = '';

    ytdlp.stdout.on('data', (data) => {
      output += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      error += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code !== 0 || !output) {
        console.error('[YouTube] yt-dlp error:', error);
        resolve(null);
        return;
      }

      try {
        const info = JSON.parse(output);
        resolve({
          title: info.title || 'Unknown',
          duration: (info.duration || 0) * 1000,
          url: info.url || info.webpage_url,
          thumbnail: info.thumbnail,
          uploader: info.uploader || info.channel,
        });
      } catch (e) {
        console.error('[YouTube] Failed to parse yt-dlp output:', e);
        resolve(null);
      }
    });

    ytdlp.on('error', (err) => {
      console.error('[YouTube] yt-dlp spawn error:', err);
      resolve(null);
    });
  });
}

interface StreamUrls {
  video: string;
  audio: string | null;
}

async function getStreamUrls(url: string): Promise<StreamUrls | null> {
  return new Promise((resolve) => {
    const ytdlp = spawn('yt-dlp', [
      '-g',
      '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
      '--no-playlist',
      '--no-warnings',
      url
    ]);

    let output = '';
    let error = '';

    ytdlp.stdout.on('data', (data) => {
      output += data.toString();
    });

    ytdlp.stderr.on('data', (data) => {
      error += data.toString();
    });

    ytdlp.on('close', (code) => {
      if (code !== 0 || !output.trim()) {
        console.error('[YouTube] yt-dlp stream URL error:', error);
        resolve(null);
        return;
      }
      const urls = output.trim().split('\n');
      resolve({
        video: urls[0],
        audio: urls[1] || null, // YouTube returns video first, then audio
      });
    });

    ytdlp.on('error', (err) => {
      console.error('[YouTube] yt-dlp spawn error:', err);
      resolve(null);
    });
  });
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
    const info = await getYouTubeInfo(url);
    if (!info) {
      await statusMsg.edit('❌ Failed to get video info. Make sure yt-dlp is installed and the URL is valid.');
      return;
    }

    await statusMsg.edit(`📺 Loading: **${info.title}**\n⏳ Getting stream URL...`);

    const streamUrls = await getStreamUrls(url);
    if (!streamUrls) {
      await statusMsg.edit('❌ Failed to get stream URL');
      return;
    }

    const videoStreamer = getVideoStreamer();
    
    const mediaItem = {
      ratingKey: `yt-${Date.now()}`,
      key: url,
      title: info.title,
      type: 'movie' as const,
      duration: info.duration,
      thumb: info.thumbnail,
      summary: info.uploader ? `By ${info.uploader}` : undefined,
    };

    const duration = info.duration ? formatDuration(info.duration) : 'Live/Unknown';

    await statusMsg.edit(
      `📺 **Starting:** ${info.title}\n` +
      `${info.uploader ? `👤 ${info.uploader}\n` : ''}` +
      `⏱️ Duration: ${duration}\n\n` +
      `*Connecting to voice channel...*`
    );

    await videoStreamer.startExternalStream(
      message.guild.id,
      voiceChannel.id,
      mediaItem,
      streamUrls.video,
      message.author.id,
      streamUrls.audio
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));

    await statusMsg.edit(
      `📺 **Now Streaming:** ${info.title}\n` +
      `${info.uploader ? `👤 ${info.uploader}\n` : ''}` +
      `⏱️ Duration: ${duration}`
    );
  } catch (error) {
    console.error('[YouTube] Error:', error);
    await statusMsg.edit(`❌ Failed to play: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
