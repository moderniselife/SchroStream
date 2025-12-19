import type { Message } from 'discord.js-selfbot-v13';
import { searchCommand } from './search.js';
import { playCommand } from './play.js';
import { stopCommand } from './stop.js';
import { pauseCommand } from './pause.js';
import { seekCommand } from './seek.js';
import { skipCommand } from './skip.js';
import { nowPlayingCommand } from './nowplaying.js';
import { helpCommand } from './help.js';

export type CommandHandler = (message: Message, args: string[]) => Promise<void>;

const commands: Record<string, CommandHandler> = {
  help: helpCommand,
  h: helpCommand,
  commands: helpCommand,
  search: searchCommand,
  s: searchCommand,
  play: playCommand,
  p: playCommand,
  stop: stopCommand,
  pause: pauseCommand,
  resume: pauseCommand,
  seek: seekCommand,
  skip: skipCommand,
  next: skipCommand,
  np: nowPlayingCommand,
  nowplaying: nowPlayingCommand,
  playing: nowPlayingCommand,
};

export async function handleCommand(
  commandName: string,
  message: Message,
  args: string[]
): Promise<void> {
  const handler = commands[commandName];

  if (!handler) {
    return;
  }

  await handler(message, args);
}

export { commands };
