import type { Message } from 'discord.js-selfbot-v13';
import { getVideoStreamer } from '../../stream/video-streamer.js';
import { parseTimeString, formatDuration } from '../../plex/library.js';

export async function ffwdCommand(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.channel.send('❌ This command can only be used in a server');
    return;
  }

  const timeArg = args[0] || '30';
  const guildId = message.guild.id;
  const videoStreamer = getVideoStreamer();
  const session = videoStreamer.getSession(guildId);

  if (!session) {
    await message.channel.send('❌ Nothing is currently playing');
    return;
  }

  const offsetMs = parseTimeString(timeArg);

  if (offsetMs === null) {
    await message.channel.send('❌ Invalid time format. Use `HH:MM:SS`, `MM:SS`, or seconds');
    return;
  }

  const currentTime = videoStreamer.getCurrentTime(guildId);
  const newTime = Math.min(currentTime + offsetMs, session.duration);

  const statusMsg = await message.channel.send(`⏩ Skipping forward ${formatDuration(offsetMs)}...`);

  const success = await videoStreamer.seekStream(guildId, newTime);

  if (success) {
    await statusMsg.edit(`⏩ Skipped forward ${formatDuration(offsetMs)} → ${formatDuration(newTime)}`);
  } else {
    await statusMsg.edit('❌ Failed to skip forward');
  }
}

export async function rewindCommand(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.channel.send('❌ This command can only be used in a server');
    return;
  }

  const timeArg = args[0] || '30';
  const guildId = message.guild.id;
  const videoStreamer = getVideoStreamer();
  const session = videoStreamer.getSession(guildId);

  if (!session) {
    await message.channel.send('❌ Nothing is currently playing');
    return;
  }

  const offsetMs = parseTimeString(timeArg);

  if (offsetMs === null) {
    await message.channel.send('❌ Invalid time format. Use `HH:MM:SS`, `MM:SS`, or seconds');
    return;
  }

  const currentTime = videoStreamer.getCurrentTime(guildId);
  const newTime = Math.max(currentTime - offsetMs, 0);

  const statusMsg = await message.channel.send(`⏪ Rewinding ${formatDuration(offsetMs)}...`);

  const success = await videoStreamer.seekStream(guildId, newTime);

  if (success) {
    await statusMsg.edit(`⏪ Rewound ${formatDuration(offsetMs)} → ${formatDuration(newTime)}`);
  } else {
    await statusMsg.edit('❌ Failed to rewind');
  }
}
