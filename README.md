# SchroStream 🎬

Discord self-bot for streaming Plex content to voice channels.

> ⚠️ **Warning:** Self-bots violate Discord's Terms of Service. Use at your own risk.

## Features

- **Search** - Find movies and TV shows from your Plex library
- **Stream** - Play media audio to Discord voice channels
- **Playback Controls** - Pause, resume, seek, stop
- **Episode Navigation** - Skip to next episode for TV shows
- **Now Playing** - View current playback status with progress bar

## Requirements

- Node.js 18+
- FFmpeg (bundled via ffmpeg-static)
- Plex Media Server
- Discord user token (self-bot)

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/schrostream.git
cd schrostream

# Install dependencies
bun install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
```

## Configuration

Edit `.env` with your settings:

```env
# Discord user token (not a bot token!)
DISCORD_TOKEN=your_discord_user_token

# Plex server URL and token
PLEX_URL=http://localhost:32400
PLEX_TOKEN=your_plex_token

# Optional settings
DEFAULT_QUALITY=1080
MAX_BITRATE=8000
AUDIO_BITRATE=192
PREFIX=!
```

### Getting Your Discord Token

1. Open Discord in browser
2. Press F12 to open Developer Tools
3. Go to Network tab
4. Type a message in any channel
5. Look for a request and find the `Authorization` header

### Getting Your Plex Token

1. Sign in to Plex Web App
2. Browse to any media item
3. Click the three dots → "Get Info" → "View XML"
4. Find `X-Plex-Token=` in the URL

## Usage

```bash
# Development
bun dev

# Production
bun build
bun start
```

## Commands

| Command | Description |
|---------|-------------|
| `!search <query>` | Search for movies/shows |
| `!play <number>` | Play selection from search results |
| `!stop` | Stop playback and leave voice |
| `!pause` | Toggle pause/resume |
| `!seek <time>` | Seek to time (e.g., `1:30:00`, `45:00`) |
| `!skip` | Skip to next episode (TV shows) |
| `!np` | Show now playing info |

### Aliases
- `!s` → `!search`
- `!p` → `!play`
- `!next` → `!skip`
- `!playing` → `!np`

## Example Session

```
You: !search breaking bad
Bot: 🎬 Search Results for "breaking bad":
     1. [Show] Breaking Bad (2008)
     2. [Movie] El Camino: A Breaking Bad Movie (2019)
     
     Use `!play <number>` to start streaming

You: !play 1
Bot: ▶️ Now Playing: Breaking Bad S01E01 - Pilot
     ⏱️ Duration: 58:00

You: !np
Bot: 🎬 Breaking Bad S01E01 - Pilot
     ▶️ Playing
     [▓▓▓▓░░░░░░░░░░░░░░░░]
     ⏱️ 12:34 / 58:00 (21.6%)

You: !skip
Bot: ⏭️ Now Playing: Breaking Bad S01E02 - Cat's in the Bag...
     ⏱️ Duration: 48:00
```

## Architecture

```
src/
├── index.ts          # Entry point
├── config.ts         # Environment config
├── types/            # TypeScript types
├── bot/              # Discord client & commands
├── plex/             # Plex API integration
└── stream/           # FFmpeg transcoding & playback
```

## Limitations

- **Audio only** - Video streaming to Discord Go Live requires additional implementation
- **Single stream per server** - One active playback per Discord guild
- **Self-bot risks** - Account may be banned by Discord

## License

MIT
