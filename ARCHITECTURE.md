# SchroStream Architecture

> Discord self-bot for streaming Plex content to voice channels

**Last Updated:** 2024-12-19

## Overview

SchroStream connects your Plex Media Server to Discord, allowing you to stream movies and TV shows directly to voice channels using Discord's Go Live feature via a self-bot.

## System Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Discord Client │────▶│  Stream Manager  │────▶│   Plex Server   │
│ (Self-Bot)      │◀────│  (FFmpeg)        │◀────│  (Media Source) │
└─────────────────┘     └──────────────────┘     └─────────────────┘
        │                        │                        │
        ▼                        ▼                        ▼
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│    Commands     │     │   Video/Audio    │     │    Library      │
│ (text commands) │     │   Transcoding    │     │  & Metadata     │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

## Project Structure

```
src/
├── index.ts              # Entry point
├── config.ts             # Configuration loader
├── types/                # TypeScript type definitions
│   └── index.ts
├── bot/                  # Discord bot setup
│   ├── client.ts         # Self-bot client
│   └── commands/         # Command handlers
│       ├── index.ts
│       ├── search.ts
│       ├── play.ts
│       ├── stop.ts
│       ├── pause.ts
│       ├── seek.ts
│       ├── skip.ts
│       └── nowplaying.ts
├── plex/                 # Plex integration
│   ├── client.ts         # Plex API client
│   ├── search.ts         # Search functionality
│   └── library.ts        # Library/metadata
└── stream/               # Streaming logic
    ├── manager.ts        # Stream state management
    ├── player.ts         # Playback controller
    └── transcoder.ts     # FFmpeg transcoding
```

## Components

### 1. Discord Bot (`src/bot/`)
- **client.ts** - Discord.js-selfbot-v13 client setup and event handlers
- **commands/** - Text command definitions and handlers

### 2. Plex Integration (`src/plex/`)
- **client.ts** - Plex API client for authentication and requests
- **search.ts** - Media search functionality
- **library.ts** - Library browsing and metadata fetching

### 3. Stream Manager (`src/stream/`)
- **manager.ts** - Manages active streams per guild
- **player.ts** - Video/audio player with playback controls
- **transcoder.ts** - FFmpeg transcoding pipeline for Discord

## Commands

| Command | Description |
|---------|-------------|
| `!search <query>` | Search for movies/shows on Plex |
| `!play <number>` | Stream selected media to voice channel |
| `!stop` | Stop current stream and disconnect |
| `!pause` | Pause/resume playback |
| `!seek <time>` | Skip to specific timestamp (e.g., `1:30:00`) |
| `!skip` | Skip to next episode (for TV shows) |
| `!np` | Show current playback info |

## Data Flow

1. **Search Flow:**
   - User sends `!search <query>`
   - Bot queries Plex API for matching media
   - Results displayed with selection numbers

2. **Playback Flow:**
   - User sends `!play <number>` while in voice channel
   - Bot fetches stream URL from Plex
   - FFmpeg transcodes to Discord-compatible format
   - Self-bot starts screen share with video stream
   - Audio piped through voice connection

3. **Control Flow:**
   - Playback commands update stream state
   - FFmpeg process controlled for seek/pause
   - State synced with Discord status

## Technical Notes

### Self-Bot Video Streaming
- Uses `discord.js-selfbot-v13` for user account automation
- Leverages Discord's Go Live/Screen Share functionality
- Video encoded to H.264, audio to Opus

### Transcoding Pipeline
```
Plex Stream URL → FFmpeg → Discord Voice/Video
                    ↓
         [H.264 video @ configurable bitrate]
         [Opus audio @ 192kbps]
```

### Security Considerations
- Token stored in `.env` (never commit!)
- Self-bots violate Discord ToS (use at own risk)
- Plex token required for authenticated access
