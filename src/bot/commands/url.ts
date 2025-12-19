import type { Message, VoiceChannel } from 'discord.js-selfbot-v13';
import { getVideoStreamer } from '../../stream/video-streamer.js';
import { formatDuration } from '../../plex/library.js';

const SUPPORTED_EXTENSIONS = ['.m3u8', '.m3u', '.mp4', '.webm', '.mkv', '.avi', '.mov', '.ts', '.flv'];

function isStreamUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    
    if (SUPPORTED_EXTENSIONS.some(ext => path.endsWith(ext))) {
      return true;
    }
    
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'rtmp:') {
      return true;
    }
    
    return false;
  } catch {
    return false;
  }
}

function getStreamType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('.m3u8') || lower.includes('.m3u')) return 'HLS';
  if (lower.includes('.mp4')) return 'MP4';
  if (lower.includes('.webm')) return 'WebM';
  if (lower.includes('.mkv')) return 'MKV';
  if (lower.includes('.ts')) return 'MPEG-TS';
  if (lower.includes('.flv')) return 'FLV';
  if (lower.includes('rtmp://')) return 'RTMP';
  return 'Stream';
}

export async function urlCommand(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.channel.send('❌ This command can only be used in a server');
    return;
  }

  const url = args[0];
  const title = args.slice(1).join(' ') || 'External Stream';

  if (!url) {
    await message.channel.send(
      '❌ Usage: `!url <stream_url> [title]`\n\n' +
      '**Supported formats:**\n' +
      '• HLS streams (.m3u8, .m3u)\n' +
      '• Direct video files (.mp4, .webm, .mkv, .avi, .mov)\n' +
      '• MPEG-TS streams (.ts)\n' +
      '• RTMP streams (rtmp://...)\n\n' +
      'Example: `!url https://example.com/stream.m3u8 My Stream`'
    );
    return;
  }

  if (!isStreamUrl(url)) {
    await message.channel.send('❌ Invalid URL. Please provide a valid stream URL (m3u8, mp4, webm, etc.)');
    return;
  }

  const member = message.guild.members.cache.get(message.author.id);
  const voiceChannel = member?.voice.channel as VoiceChannel | undefined;

  if (!voiceChannel) {
    await message.channel.send('❌ You must be in a voice channel to use this command');
    return;
  }

  const streamType = getStreamType(url);
  const statusMsg = await message.channel.send(`🔗 Loading ${streamType} stream...`);

  try {
    const videoStreamer = getVideoStreamer();
    
    const mediaItem = {
      ratingKey: `url-${Date.now()}`,
      key: url,
      title: title,
      type: 'movie' as const,
      duration: 0,
    };

    await statusMsg.edit(
      `📺 **Starting:** ${title}\n` +
      `📡 Type: ${streamType}\n\n` +
      `*Connecting to voice channel...*`
    );

    await videoStreamer.startExternalStream(
      message.guild.id,
      voiceChannel.id,
      mediaItem,
      url,
      message.author.id
    );

    await new Promise((resolve) => setTimeout(resolve, 2000));

    await statusMsg.edit(
      `📺 **Now Streaming:** ${title}\n` +
      `📡 Type: ${streamType}`
    );
  } catch (error) {
    console.error('[URL] Error:', error);
    await statusMsg.edit(`❌ Failed to play stream: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
