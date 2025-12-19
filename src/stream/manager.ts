import { Player } from './player.js';
import type { PlexMediaItem, StreamState } from '../types/index.js';

class StreamManager {
  private players: Map<string, Player> = new Map();

  getPlayer(guildId: string): Player {
    let player = this.players.get(guildId);

    if (!player) {
      player = new Player();
      this.players.set(guildId, player);

      player.on('stop', () => {
        console.log(`[StreamManager] Stream stopped in guild ${guildId}`);
      });
    }

    return player;
  }

  getState(guildId: string): StreamState | null {
    const player = this.players.get(guildId);
    return player?.currentState ?? null;
  }

  isPlaying(guildId: string): boolean {
    const player = this.players.get(guildId);
    return player?.isPlaying ?? false;
  }

  async play(
    guildId: string,
    channelId: string,
    mediaItem: PlexMediaItem,
    startTime = 0
  ): Promise<{ stream: NodeJS.ReadableStream; streamUrl: string }> {
    const player = this.getPlayer(guildId);
    return player.play(mediaItem, guildId, channelId, startTime);
  }

  async pause(guildId: string): Promise<void> {
    const player = this.players.get(guildId);
    if (player) {
      await player.pause();
    }
  }

  async resume(guildId: string): Promise<{ stream: NodeJS.ReadableStream } | null> {
    const player = this.players.get(guildId);
    if (player) {
      return player.resume();
    }
    return null;
  }

  async seek(guildId: string, timeMs: number): Promise<{ stream: NodeJS.ReadableStream } | null> {
    const player = this.players.get(guildId);
    if (player) {
      return player.seek(timeMs);
    }
    return null;
  }

  async stop(guildId: string): Promise<void> {
    const player = this.players.get(guildId);
    if (player) {
      await player.stop();
    }
  }

  getProgress(guildId: string): { current: number; total: number; percentage: number } {
    const player = this.players.get(guildId);
    if (player) {
      return player.getProgress();
    }
    return { current: 0, total: 0, percentage: 0 };
  }

  cleanup(guildId: string): void {
    const player = this.players.get(guildId);
    if (player) {
      player.stop();
      this.players.delete(guildId);
    }
  }
}

export const streamManager = new StreamManager();
export default streamManager;
