/**
 * Simple in-memory data store for yt-cast-receiver
 * Avoids the node-persist issues in Docker containers
 */
export class InMemoryDataStore {
  private data: Map<string, unknown> = new Map();

  async get<T>(key: string): Promise<T | null> {
    const value = this.data.get(key);
    return value !== undefined ? (value as T) : null;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, value);
  }

  async clear(): Promise<void> {
    this.data.clear();
  }
}
