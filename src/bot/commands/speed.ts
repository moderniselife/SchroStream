import type { Message } from 'discord.js-selfbot-v13';
import { getVideoStreamer } from '../../stream/video-streamer.js';

export async function speedCommand(message: Message, args: string[]): Promise<void> {
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

  const speedArg = args[0];
  
  // If no argument, show current speed
  if (!speedArg) {
    const currentSpeed = videoStreamer.getSpeed(guildId);
    await message.channel.send(`⏩ Current playback speed: **${currentSpeed}x**\n\nUsage: \`!speed <multiplier>\`\nExamples: \`!speed 1.5\`, \`!speed 2\`, \`!speed 0.75\`\nRange: 0.5x - 3x`);
    return;
  }

  // Parse speed value
  let speed = parseFloat(speedArg.replace('x', ''));
  
  if (isNaN(speed)) {
    await message.channel.send('❌ Invalid speed. Use a number like `1.5` or `2x`');
    return;
  }

  // Clamp speed
  speed = Math.max(0.5, Math.min(3, speed));

  const statusMsg = await message.channel.send(`⏩ Setting playback speed to ${speed}x...`);

  const success = await videoStreamer.setSpeed(guildId, speed);

  if (success) {
    const speedEmoji = speed > 1 ? '⏩' : speed < 1 ? '⏪' : '▶️';
    await statusMsg.edit(`${speedEmoji} Playback speed set to **${speed}x**`);
  } else {
    await statusMsg.edit('❌ Failed to change playback speed');
  }
}
