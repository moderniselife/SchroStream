export interface PlexMediaItem {
  ratingKey: string;
  key: string;
  type: 'movie' | 'show' | 'season' | 'episode' | 'channel';
  title: string;
  year?: number;
  summary?: string;
  thumb?: string;
  art?: string;
  duration?: number;
  addedAt?: number;
  parentTitle?: string;
  grandparentTitle?: string;
  parentRatingKey?: string;
  grandparentRatingKey?: string;
  index?: number;
  parentIndex?: number;
  rating?: number;
  childCount?: number;
}

export interface YouTubeMediaItem {
  ratingKey: string;
  key: string;
  type: 'youtube';
  title: string;
  duration: number;
  thumb?: string;
  uploader?: string;
  viewCount?: string;
  uploadDate?: string;
  description?: string;
  url: string;
  filePath?: string;
}

export interface ExternalStreamItem {
  ratingKey: string;
  key: string;
  type: 'external';
  title: string;
  duration: number;
  url: string;
  streamType?: string;
}

export interface MusicMediaItem {
  ratingKey: string;
  key: string;
  type: 'music';
  title: string;
  artist: string;
  duration: number;
  thumb?: string;
  url: string;
  audioPath: string;
  thumbnailPath: string;
}

export type MediaItem = PlexMediaItem | YouTubeMediaItem | ExternalStreamItem | MusicMediaItem;

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
  userId?: string;
  sessionId?: string;
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
    allowedUsers: string[];
    allowedRoles: string[];
    allowedGuilds: string[];
    botToken?: string;
    clientId?: string;
    webUserId?: string;
    webGuildId?: string;
    webChannelId?: string;
  };
  plex: {
    url: string;
    token: string;
    clientIdentifier: string;
  };
  stream: {
    defaultQuality: number;
    maxBitrate: number;
    audioBitrate: number;
    frameRate: number;
    showFFmpegLogs: boolean;
    gpuTranscoding: boolean;
  };
  voice: {
    enabled: boolean;
    wakeWord: string;
    modelPath?: string;
  };
  youtube: {
    cookiesFile: string;
  };
}

export interface SearchSession {
  results: PlexMediaItem[];
  query: string;
  timestamp: number;
}
