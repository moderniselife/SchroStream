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

function parseCommaSeparated(value: string | undefined): string[] {
  if (!value || value.trim() === '') return [];
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

export const config: Config = {
  discord: {
    token: getEnvOrThrow('DISCORD_TOKEN'),
    prefix: getEnvOrDefault('PREFIX', '!'),
    allowedUsers: parseCommaSeparated(process.env.ALLOWED_USERS),
    allowedRoles: parseCommaSeparated(process.env.ALLOWED_ROLES),
    allowedGuilds: parseCommaSeparated(process.env.ALLOWED_GUILDS),
    botToken: process.env.BOT_TOKEN,
    clientId: process.env.BOT_CLIENT_ID,
  },
  plex: {
    url: getEnvOrThrow('PLEX_URL').replace(/\/$/, ''),
    token: getEnvOrThrow('PLEX_TOKEN'),
    clientIdentifier: getEnvOrDefault('PLEX_CLIENT_IDENTIFIER', 'SchroStream'),
  },
  stream: {
    defaultQuality: parseInt(getEnvOrDefault('DEFAULT_QUALITY', '1080'), 10),
    maxBitrate: parseInt(getEnvOrDefault('MAX_BITRATE', '10000'), 10),
    audioBitrate: parseInt(getEnvOrDefault('AUDIO_BITRATE', '256'), 10),
    frameRate: parseInt(getEnvOrDefault('FRAME_RATE', '30'), 10),
  },
};

export default config;
