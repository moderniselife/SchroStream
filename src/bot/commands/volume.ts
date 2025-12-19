import type { Message } from 'discord.js-selfbot-v13';
import { getVideoStreamer } from '../../stream/video-streamer.js';

export async function volumeCommand(message: Message, args: string[]): Promise<void> {
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

  // If no args, show current volume
  if (args.length === 0) {
    const currentVolume = session.volume ?? 100;
    await message.channel.send(`🔊 Current volume: **${currentVolume}%**`);
    return;
  }

  const volumeArg = args[0].replace('%', '');
  const volume = parseInt(volumeArg, 10);

  if (isNaN(volume) || volume < 0 || volume > 200) {
    await message.channel.send('❌ Volume must be a number between 0 and 200');
    return;
  }

  const statusMsg = await message.channel.send(`🔊 Changing volume to **${volume}%**...`);
  
  const success = await videoStreamer.setVolume(guildId, volume);

  if (success) {
    const icon = volume === 0 ? '🔇' : volume < 50 ? '🔈' : volume < 100 ? '🔉' : '🔊';
    await statusMsg.edit(`${icon} Volume set to **${volume}%**`);
  } else {
    await statusMsg.edit('❌ Failed to set volume');
  }
}
