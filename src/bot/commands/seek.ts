import type { Message } from 'discord.js-selfbot-v13';
import { getVideoStreamer } from '../../stream/video-streamer.js';
import { parseTimeString, formatDuration } from '../../plex/library.js';

export async function seekCommand(message: Message, args: string[]): Promise<void> {
  if (!message.guild) {
    await message.channel.send('❌ This command can only be used in a server');
    return;
  }

  const timeArg = args[0];
  if (!timeArg) {
    await message.channel.send('❌ Usage: `!seek <time>` (e.g., `!seek 1:30:00` or `!seek 45:00`)');
    return;
  }

  const guildId = message.guild.id;
  const videoStreamer = getVideoStreamer();
  const session = videoStreamer.getSession(guildId);

  if (!session) {
    await message.channel.send('❌ Nothing is currently playing');
    return;
  }

  const timeMs = parseTimeString(timeArg);

  if (timeMs === null) {
    await message.channel.send('❌ Invalid time format. Use `HH:MM:SS`, `MM:SS`, or seconds');
    return;
  }

  const statusMsg = await message.channel.send(`⏩ Seeking to ${formatDuration(timeMs)}...`);

  const success = await videoStreamer.seekStream(guildId, timeMs);

  if (success) {
    await statusMsg.edit(`⏩ Seeked to ${formatDuration(timeMs)}`);
  } else {
    await statusMsg.edit('❌ Failed to seek');
  }
}
