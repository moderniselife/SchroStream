import plexClient from './client.js';
import type { PlexMediaItem, SearchSession } from '../types/index.js';

const searchSessions = new Map<string, SearchSession>();

export async function searchMedia(query: string, userId: string): Promise<PlexMediaItem[]> {
  const results = await plexClient.search(query);

  searchSessions.set(userId, {
    results,
    query,
    timestamp: Date.now(),
  });

  return results;
}

export function getSearchSession(userId: string): SearchSession | undefined {
  const session = searchSessions.get(userId);

  if (session && Date.now() - session.timestamp > 5 * 60 * 1000) {
    searchSessions.delete(userId);
    return undefined;
  }

  return session;
}

export function getSearchResult(userId: string, index: number): PlexMediaItem | undefined {
  const session = getSearchSession(userId);
  if (!session) return undefined;

  return session.results[index - 1];
}

export function clearSearchSession(userId: string): void {
  searchSessions.delete(userId);
}

export function formatSearchResults(items: PlexMediaItem[]): string {
  if (items.length === 0) {
    return 'No results found.';
  }

  // Separate by type
  const movies = items.filter(item => item.type === 'movie');
  const shows = items.filter(item => item.type === 'show');
  const episodes = items.filter(item => item.type === 'episode');

  const sections: string[] = [];
  let globalIndex = 0;

  // Format a single item
  const formatItem = (item: PlexMediaItem): string => {
    globalIndex++;
    const num = `**${globalIndex}.**`;
    const title = item.title;
    const year = item.year ? ` (${item.year})` : '';

    let extra = '';
    if (item.type === 'episode') {
      const show = item.grandparentTitle || '';
      const season = item.parentIndex ? `S${String(item.parentIndex).padStart(2, '0')}` : '';
      const episode = item.index ? `E${String(item.index).padStart(2, '0')}` : '';
      extra = ` - ${show} ${season}${episode}`;
    }

    return `${num} ${title}${year}${extra}`;
  };

  // Movies section
  if (movies.length > 0) {
    const movieLines = movies.map(formatItem);
    sections.push(`**🎬 Movies (${movies.length})**\n${movieLines.join('\n')}`);
  }

  // TV Shows section
  if (shows.length > 0) {
    const showLines = shows.map(formatItem);
    sections.push(`**📺 TV Shows (${shows.length})**\n${showLines.join('\n')}`);
  }

  // Episodes section (if any direct episode matches)
  if (episodes.length > 0) {
    const episodeLines = episodes.map(formatItem);
    sections.push(`**📼 Episodes (${episodes.length})**\n${episodeLines.join('\n')}`);
  }

  return sections.join('\n\n');
}

export default {
  searchMedia,
  getSearchSession,
  getSearchResult,
  clearSearchSession,
  formatSearchResults,
};
