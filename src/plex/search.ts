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

  const lines = items.slice(0, 10).map((item, index) => {
    const num = `**${index + 1}.**`;
    const title = item.title;
    const year = item.year ? ` (${item.year})` : '';
    const type = item.type.charAt(0).toUpperCase() + item.type.slice(1);

    let extra = '';
    if (item.type === 'episode') {
      const show = item.grandparentTitle || '';
      const season = item.parentIndex ? `S${String(item.parentIndex).padStart(2, '0')}` : '';
      const episode = item.index ? `E${String(item.index).padStart(2, '0')}` : '';
      extra = ` - ${show} ${season}${episode}`;
    }

    return `${num} [${type}] ${title}${year}${extra}`;
  });

  if (items.length > 10) {
    lines.push(`\n*...and ${items.length - 10} more results*`);
  }

  return lines.join('\n');
}

export default {
  searchMedia,
  getSearchSession,
  getSearchResult,
  clearSearchSession,
  formatSearchResults,
};
