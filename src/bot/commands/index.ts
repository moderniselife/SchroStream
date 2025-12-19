import type { Message } from 'discord.js-selfbot-v13';
import { searchCommand } from './search.js';
import { playCommand } from './play.js';
import { stopCommand } from './stop.js';
import { pauseCommand } from './pause.js';
import { seekCommand } from './seek.js';
import { skipCommand } from './skip.js';
import { nowPlayingCommand } from './nowplaying.js';
import { helpCommand } from './help.js';
import { volumeCommand } from './volume.js';
import { episodesCommand } from './episodes.js';
import { randomCommand } from './random.js';
import { onDeckCommand } from './ondeck.js';
import { queueCommand } from './queue.js';
import { ffwdCommand, rewindCommand } from './ffwd.js';
import { youtubeCommand } from './youtube.js';
import { urlCommand } from './url.js';

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
  volume: volumeCommand,
  vol: volumeCommand,
  v: volumeCommand,
  episodes: episodesCommand,
  eps: episodesCommand,
  seasons: episodesCommand,
  random: randomCommand,
  rand: randomCommand,
  ondeck: onDeckCommand,
  deck: onDeckCommand,
  continue: onDeckCommand,
  queue: queueCommand,
  q: queueCommand,
  ff: ffwdCommand,
  ffwd: ffwdCommand,
  forward: ffwdCommand,
  rw: rewindCommand,
  rewind: rewindCommand,
  back: rewindCommand,
  yt: youtubeCommand,
  youtube: youtubeCommand,
  url: urlCommand,
  stream: urlCommand,
  m3u8: urlCommand,
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
