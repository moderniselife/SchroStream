import type { Message } from 'discord.js-selfbot-v13';
import streamManager from '../../stream/manager.js';
import { formatDuration } from '../../plex/library.js';

export async function nowPlayingCommand(message: Message, _args: string[]): Promise<void> {
  if (!message.guild) {
    await message.edit('❌ This command can only be used in a server');
    return;
  }

  const guildId = message.guild.id;
  const state = streamManager.getState(guildId);

  if (!state) {
    await message.edit('❌ Nothing is currently playing');
    return;
  }

  const { current, total, percentage } = streamManager.getProgress(guildId);

  let title = state.mediaItem.title;
  if (state.mediaItem.type === 'episode' && state.mediaItem.grandparentTitle) {
    const season = state.mediaItem.parentIndex
      ? `S${String(state.mediaItem.parentIndex).padStart(2, '0')}`
      : '';
    const episode = state.mediaItem.index
      ? `E${String(state.mediaItem.index).padStart(2, '0')}`
      : '';
    title = `${state.mediaItem.grandparentTitle} ${season}${episode} - ${state.mediaItem.title}`;
  }

  const status = state.isPaused ? '⏸️ Paused' : '▶️ Playing';
  const progress = `${formatDuration(current)} / ${formatDuration(total)}`;
  const progressBar = createProgressBar(percentage);

  const info = [
    `🎬 **${title}**`,
    ``,
    `${status}`,
    `${progressBar}`,
    `⏱️ ${progress} (${percentage.toFixed(1)}%)`,
  ];

  if (state.mediaItem.year) {
    info.push(`📅 ${state.mediaItem.year}`);
  }

  await message.edit(info.join('\n'));
}

function createProgressBar(percentage: number): string {
  const total = 20;
  const filled = Math.round((percentage / 100) * total);
  const empty = total - filled;

  return `[${'▓'.repeat(filled)}${'░'.repeat(empty)}]`;
}
