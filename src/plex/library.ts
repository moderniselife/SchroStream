import plexClient from './client.js';
import type { PlexMediaItem } from '../types/index.js';

export async function getLibraries() {
  return plexClient.getLibraries();
}

export async function getMediaDetails(ratingKey: string): Promise<PlexMediaItem | null> {
  return plexClient.getMetadata(ratingKey);
}

export async function getShowEpisodes(showKey: string): Promise<PlexMediaItem[]> {
  return plexClient.getEpisodes(showKey);
}

export async function getShowSeasons(showKey: string): Promise<PlexMediaItem[]> {
  return plexClient.getSeasons(showKey);
}

export async function getSeasonEpisodes(seasonKey: string): Promise<PlexMediaItem[]> {
  return plexClient.getSeasonEpisodes(seasonKey);
}

export async function getNextEpisode(
  currentEpisode: PlexMediaItem
): Promise<PlexMediaItem | null> {
  if (currentEpisode.type !== 'episode') {
    return null;
  }

  // Use grandparentRatingKey (the show's rating key)
  const showKey = currentEpisode.grandparentRatingKey;
  
  if (!showKey) {
    console.log('[Skip] No grandparentRatingKey found for episode');
    return null;
  }

  console.log(`[Skip] Looking for next episode after S${currentEpisode.parentIndex}E${currentEpisode.index} in show ${showKey}`);
  
  const episodes = await plexClient.getEpisodes(showKey);
  console.log(`[Skip] Found ${episodes.length} episodes in show`);

  // Sort episodes by season and episode number
  episodes.sort((a, b) => {
    const seasonDiff = (a.parentIndex || 0) - (b.parentIndex || 0);
    if (seasonDiff !== 0) return seasonDiff;
    return (a.index || 0) - (b.index || 0);
  });

  const currentIndex = episodes.findIndex(
    (ep) => ep.ratingKey === currentEpisode.ratingKey
  );

  console.log(`[Skip] Current episode index: ${currentIndex}, total: ${episodes.length}`);

  if (currentIndex === -1 || currentIndex >= episodes.length - 1) {
    return null;
  }

  const nextEp = episodes[currentIndex + 1];
  console.log(`[Skip] Next episode: S${nextEp.parentIndex}E${nextEp.index} - ${nextEp.title}`);
  
  return nextEp;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function parseTimeString(timeStr: string): number | null {
  const parts = timeStr.split(':').map((p) => parseInt(p, 10));

  if (parts.some(isNaN)) return null;

  if (parts.length === 3) {
    const [hours, minutes, seconds] = parts;
    return (hours * 3600 + minutes * 60 + seconds) * 1000;
  }

  if (parts.length === 2) {
    const [minutes, seconds] = parts;
    return (minutes * 60 + seconds) * 1000;
  }

  if (parts.length === 1) {
    return parts[0] * 1000;
  }

  return null;
}

export default {
  getLibraries,
  getMediaDetails,
  getShowEpisodes,
  getShowSeasons,
  getSeasonEpisodes,
  getNextEpisode,
  formatDuration,
  parseTimeString,
};
