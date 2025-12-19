import { EventEmitter } from 'events';
import type { PlexMediaItem, StreamState } from '../types/index.js';
import { createAudioOnlyStream } from './transcoder.js';
import plexClient from '../plex/client.js';

export class Player extends EventEmitter {
  private state: StreamState | null = null;
  private currentStream: ReturnType<typeof createAudioOnlyStream> | null = null;
  private pausedAt: number = 0;

  get currentState(): StreamState | null {
    return this.state;
  }

  get isPlaying(): boolean {
    return this.state !== null && !this.state.isPaused;
  }

  get isPaused(): boolean {
    return this.state?.isPaused ?? false;
  }

  get currentTime(): number {
    if (!this.state) return 0;
    if (this.state.isPaused) return this.pausedAt;

    const elapsed = Date.now() - this.state.startedAt;
    return this.state.currentTime + elapsed;
  }

  async play(
    mediaItem: PlexMediaItem,
    guildId: string,
    channelId: string,
    startTime = 0
  ): Promise<{ stream: NodeJS.ReadableStream; streamUrl: string }> {
    await this.stop();

    const streamInfo = await plexClient.getDirectStreamUrl(mediaItem.ratingKey);
    if (!streamInfo) {
      throw new Error('Could not get stream URL for media');
    }

    const audioStream = createAudioOnlyStream(streamInfo.url, startTime / 1000);

    this.currentStream = audioStream;

    this.state = {
      guildId,
      channelId,
      mediaItem,
      streamUrl: streamInfo.url,
      isPaused: false,
      currentTime: startTime,
      startedAt: Date.now(),
      duration: mediaItem.duration || 0,
    };

    this.emit('play', this.state);

    return {
      stream: audioStream.stream,
      streamUrl: streamInfo.url,
    };
  }

  async pause(): Promise<void> {
    if (!this.state || this.state.isPaused) return;

    this.pausedAt = this.currentTime;
    this.state.isPaused = true;

    if (this.currentStream) {
      this.currentStream.kill();
      this.currentStream = null;
    }

    this.emit('pause', this.state);
  }

  async resume(): Promise<{ stream: NodeJS.ReadableStream } | null> {
    if (!this.state || !this.state.isPaused) return null;

    const streamInfo = await plexClient.getDirectStreamUrl(
      this.state.mediaItem.ratingKey
    );
    if (!streamInfo) {
      throw new Error('Could not get stream URL for media');
    }

    const audioStream = createAudioOnlyStream(
      streamInfo.url,
      this.pausedAt / 1000
    );

    this.currentStream = audioStream;

    this.state.isPaused = false;
    this.state.currentTime = this.pausedAt;
    this.state.startedAt = Date.now();

    this.emit('resume', this.state);

    return { stream: audioStream.stream };
  }

  async seek(timeMs: number): Promise<{ stream: NodeJS.ReadableStream } | null> {
    if (!this.state) return null;

    if (this.currentStream) {
      this.currentStream.kill();
      this.currentStream = null;
    }

    const streamInfo = await plexClient.getDirectStreamUrl(
      this.state.mediaItem.ratingKey
    );
    if (!streamInfo) {
      throw new Error('Could not get stream URL for media');
    }

    const clampedTime = Math.max(0, Math.min(timeMs, this.state.duration));
    const audioStream = createAudioOnlyStream(streamInfo.url, clampedTime / 1000);

    this.currentStream = audioStream;

    this.state.currentTime = clampedTime;
    this.state.startedAt = Date.now();
    this.state.isPaused = false;

    this.emit('seek', this.state, clampedTime);

    return { stream: audioStream.stream };
  }

  async stop(): Promise<void> {
    if (this.currentStream) {
      this.currentStream.kill();
      this.currentStream = null;
    }

    const previousState = this.state;
    this.state = null;
    this.pausedAt = 0;

    if (previousState) {
      this.emit('stop', previousState);
    }
  }

  getProgress(): { current: number; total: number; percentage: number } {
    if (!this.state) {
      return { current: 0, total: 0, percentage: 0 };
    }

    const current = this.currentTime;
    const total = this.state.duration;
    const percentage = total > 0 ? (current / total) * 100 : 0;

    return { current, total, percentage };
  }
}

export default Player;
