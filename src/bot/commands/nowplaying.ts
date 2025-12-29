import type { Message } from 'discord.js-selfbot-v13';
import { getVideoStreamer } from '../../stream/video-streamer.js';
import { formatDuration } from '../../plex/library.js';

export async function nowPlayingCommand(message: Message, _args: string[]): Promise<void> {
  if (!message.guild) {
    await message.channel.send('❌ This command can only be used in a server');
    return;
  }

  const guildId = message.guild.id;
  const videoStreamer = getVideoStreamer();
  const session = videoStreamer.getSession(guildId);

  if (!session) {
    await message.channel.send('❌ Nothing is currently playing');
    return;
  }

  const { current, total, percentage } = videoStreamer.getProgress(guildId);

  let title = session.mediaItem.title;
  if (session.mediaItem.type === 'episode' && session.mediaItem.grandparentTitle) {
    const season = session.mediaItem.parentIndex
      ? `S${String(session.mediaItem.parentIndex).padStart(2, '0')}`
      : '';
    const episode = session.mediaItem.index
      ? `E${String(session.mediaItem.index).padStart(2, '0')}`
      : '';
    title = `${session.mediaItem.grandparentTitle} ${season}${episode} - ${session.mediaItem.title}`;
  }

  const status = session.isPaused ? '⏸️ Paused' : '📺 Streaming (Go Live)';
  const progress = `${formatDuration(current)} / ${formatDuration(total)}`;
  const progressBar = createProgressBar(percentage);

  const info = [
    `🎬 **${title}**`,
    ``,
    `${status}`,
    `${progressBar}`,
    `⏱️ ${progress} (${percentage.toFixed(1)}%)`,
  ];

  // Add date/year info based on media type
  if (session.mediaItem.type === 'movie' || session.mediaItem.type === 'show' || session.mediaItem.type === 'episode' || session.mediaItem.type === 'channel') {
    // Plex media item
    const plexItem = session.mediaItem as any;
    if (plexItem.year) {
      info.push(`📅 ${plexItem.year}`);
    }
  } else if (session.mediaItem.type === 'youtube') {
    // YouTube item
    const ytItem = session.mediaItem as any;
    if (ytItem.uploadDate) {
      info.push(`📅 ${ytItem.uploadDate}`);
    }
  }

  await message.channel.send(info.join('\n'));
}

function createProgressBar(percentage: number): string {
  const total = 20;
  const filled = Math.round((percentage / 100) * total);
  const empty = total - filled;

  return `[${'▓'.repeat(filled)}${'░'.repeat(empty)}]`;
}
