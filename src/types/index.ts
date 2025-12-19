export interface PlexMediaItem {
  ratingKey: string;
  key: string;
  type: 'movie' | 'show' | 'season' | 'episode';
  title: string;
  year?: number;
  summary?: string;
  thumb?: string;
  art?: string;
  duration?: number;
  addedAt?: number;
  parentTitle?: string;
  grandparentTitle?: string;
  index?: number;
  parentIndex?: number;
}

export interface PlexSearchResult {
  items: PlexMediaItem[];
  totalSize: number;
}

export interface PlexStreamInfo {
  url: string;
  container: string;
  videoCodec?: string;
  audioCodec?: string;
  bitrate?: number;
  width?: number;
  height?: number;
}

export interface PlexEpisode extends PlexMediaItem {
  type: 'episode';
  seasonNumber: number;
  episodeNumber: number;
  showTitle: string;
}

export interface StreamState {
  guildId: string;
  channelId: string;
  mediaItem: PlexMediaItem;
  streamUrl: string;
  isPaused: boolean;
  currentTime: number;
  startedAt: number;
  duration: number;
}

export interface PlaybackControls {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  seek: (timeSeconds: number) => Promise<void>;
}

export interface TranscodeOptions {
  width?: number;
  height?: number;
  videoBitrate?: number;
  audioBitrate?: number;
  audioChannels?: number;
  fps?: number;
}

export interface Config {
  discord: {
    token: string;
    prefix: string;
    ownerId: string | null;
    allowedGuilds: string[];
  };
  plex: {
    url: string;
    token: string;
  };
  stream: {
    defaultQuality: number;
    maxBitrate: number;
    audioBitrate: number;
  };
}

export interface SearchSession {
  results: PlexMediaItem[];
  query: string;
  timestamp: number;
}
