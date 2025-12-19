import { config as dotenvConfig } from 'dotenv';
import type { Config } from './types/index.js';

dotenvConfig();

function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

export const config: Config = {
  discord: {
    token: getEnvOrThrow('DISCORD_TOKEN'),
    prefix: getEnvOrDefault('PREFIX', '!'),
  },
  plex: {
    url: getEnvOrThrow('PLEX_URL').replace(/\/$/, ''),
    token: getEnvOrThrow('PLEX_TOKEN'),
  },
  stream: {
    defaultQuality: parseInt(getEnvOrDefault('DEFAULT_QUALITY', '1080'), 10),
    maxBitrate: parseInt(getEnvOrDefault('MAX_BITRATE', '8000'), 10),
    audioBitrate: parseInt(getEnvOrDefault('AUDIO_BITRATE', '192'), 10),
  },
};

export default config;
