import type { Message } from 'discord.js-selfbot-v13';
import { getVideoStreamer } from '../../stream/video-streamer.js';

export async function stopCommand(message: Message, _args: string[]): Promise<void> {
  if (!message.guild) {
    await message.edit('❌ This command can only be used in a server');
    return;
  }

  const guildId = message.guild.id;
  const videoStreamer = getVideoStreamer();
  const session = videoStreamer.getSession(guildId);

  if (!session) {
    await message.edit('❌ Nothing is currently playing');
    return;
  }

  await videoStreamer.stopStream(guildId);
  await message.edit('⏹️ Playback stopped');
}
