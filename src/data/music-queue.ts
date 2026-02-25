import type { MusicTrackInfo } from '../youtube/music-downloader.js';

export interface MusicQueueState {
  tracks: MusicTrackInfo[];
  autoplay: boolean;
  lastPlayedVideoId?: string;
  playlistName?: string;
}

// Per-guild music queues
const musicQueues = new Map<string, MusicQueueState>();

export function getMusicQueue(guildId: string): MusicQueueState {
  if (!musicQueues.has(guildId)) {
    musicQueues.set(guildId, { tracks: [], autoplay: true });
  }
  return musicQueues.get(guildId)!;
}

export function seedMusicQueue(guildId: string, tracks: MusicTrackInfo[], playlistName?: string): void {
  const state = getMusicQueue(guildId);
  state.tracks = [...tracks];
  state.playlistName = playlistName;
  console.log(`[MusicQueue] Seeded ${tracks.length} tracks for guild ${guildId}`);
}

export function addToMusicQueue(guildId: string, tracks: MusicTrackInfo[]): void {
  const state = getMusicQueue(guildId);
  state.tracks.push(...tracks);
  console.log(`[MusicQueue] Added ${tracks.length} tracks to queue for guild ${guildId} (total: ${state.tracks.length})`);
}

export function popMusicQueue(guildId: string): MusicTrackInfo | null {
  const state = getMusicQueue(guildId);
  if (state.tracks.length === 0) return null;
  const track = state.tracks.shift()!;
  console.log(`[MusicQueue] Popped "${track.title}" from queue for guild ${guildId} (${state.tracks.length} remaining)`);
  return track;
}

export function peekMusicQueue(guildId: string): MusicTrackInfo | null {
  const state = getMusicQueue(guildId);
  return state.tracks[0] ?? null;
}

export function clearMusicQueue(guildId: string): void {
  const state = getMusicQueue(guildId);
  state.tracks = [];
  state.lastPlayedVideoId = undefined;
  state.playlistName = undefined;
  console.log(`[MusicQueue] Cleared music queue for guild ${guildId}`);
}

export function setLastPlayedVideoId(guildId: string, videoId: string): void {
  const state = getMusicQueue(guildId);
  state.lastPlayedVideoId = videoId;
}

export function getMusicQueueLength(guildId: string): number {
  return getMusicQueue(guildId).tracks.length;
}

export function setAutoplay(guildId: string, enabled: boolean): void {
  const state = getMusicQueue(guildId);
  state.autoplay = enabled;
  console.log(`[MusicQueue] Autoplay ${enabled ? 'enabled' : 'disabled'} for guild ${guildId}`);
}

export function isAutoplayEnabled(guildId: string): boolean {
  return getMusicQueue(guildId).autoplay;
}
