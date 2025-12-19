import type { Message } from 'discord.js-selfbot-v13';
import { getVideoStreamer } from '../../stream/video-streamer.js';

export async function pauseCommand(message: Message, _args: string[]): Promise<void> {
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

  if (session.isPaused) {
    const success = await videoStreamer.resumeStream(guildId);
    if (success) {
      await message.channel.send('▶️ Playback resumed');
    } else {
      await message.channel.send('❌ Failed to resume playback');
    }
  } else {
    const success = await videoStreamer.pauseStream(guildId);
    if (success) {
      await message.channel.send('⏸️ Playback paused');
    } else {
      await message.channel.send('❌ Failed to pause playback');
    }
  }
}
