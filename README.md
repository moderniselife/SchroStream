# SchroStream 🎬

Discord self-bot for streaming Plex content to voice channels.

> ⚠️ **Warning:** Self-bots violate Discord's Terms of Service. Use at your own risk.

## Features

- **Video Streaming** - Stream movies and TV shows via Discord Go Live
- **Search** - Find movies and TV shows from your Plex library
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

> ⚠️ **Never share your token with anyone.** It grants full access to your account.

#### Method 1: Browser Developer Tools (Recommended)

1. Open [Discord Web](https://discord.com/app) in your browser
2. Press `F12` (or `Cmd+Option+I` on Mac) to open Developer Tools
3. Go to the **Network** tab
4. In the filter box, type `api`
5. Send a message in any channel or perform any action
6. Click on any request (e.g., `messages`, `science`, etc.)
7. In the **Headers** tab, scroll down to find `authorization`
8. Copy the token value (it looks like `mfa.xxxxx` or `NzkyNTg...`)

#### Method 2: Console Command

1. Open Discord in browser and press `F12`
2. Go to the **Console** tab
3. Paste and run:
   ```js
   (webpackChunkdiscord_app.push([[''],{},e=>{m=[];for(let c in e.c)m.push(e.c[c])}]),m).find(m=>m?.exports?.default?.getToken).exports.default.getToken()
   ```
4. Copy the returned token string

#### Method 3: Discord Desktop App

1. Open Discord desktop app
2. Press `Ctrl+Shift+I` (or `Cmd+Option+I` on Mac)
3. Go to **Console** tab and run the same script as Method 2

### Getting Your Plex Token

#### Method 1: Via Plex Web App URL

1. Sign in to [Plex Web App](https://app.plex.tv)
2. Navigate to any media item in your library
3. Click the **⋮** (three dots) menu → **Get Info**
4. Click **View XML** at the bottom of the info panel
5. A new tab opens with XML data - look at the URL
6. Find `X-Plex-Token=YOUR_TOKEN_HERE` in the URL
7. Copy just the token value

#### Method 2: Via Plex Account Page

1. Go to [plex.tv/devices.xml](https://plex.tv/devices.xml) while logged in
2. The page will show XML with your devices
3. Find `token="YOUR_TOKEN"` attribute
4. Copy the token value

#### Method 3: Via Browser Developer Tools

1. Open [Plex Web App](https://app.plex.tv)
2. Press `F12` to open Developer Tools
3. Go to **Application** tab (Chrome) or **Storage** tab (Firefox)
4. Expand **Local Storage** → click on `https://app.plex.tv`
5. Find the key `myPlexAccessToken`
6. Copy the token value

#### Method 4: Via Command Line (macOS/Linux)

If you've signed into Plex on this machine:

```bash
# macOS
cat ~/Library/Application\ Support/Plex\ Media\ Server/Preferences.xml | grep -o 'PlexOnlineToken="[^"]*"'

# Linux
cat /var/lib/plexmediaserver/Library/Application\ Support/Plex\ Media\ Server/Preferences.xml | grep -o 'PlexOnlineToken="[^"]*"'
```

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

## Technical Details

### Video Streaming
SchroStream uses `@dank074/discord-video-stream` to enable full video streaming via Discord's Go Live feature. Videos are transcoded in real-time using FFmpeg to H.264 video + Opus audio.

### Stream Quality Settings
- **DEFAULT_QUALITY** - Video height (480, 720, 1080)
- **MAX_BITRATE** - Video bitrate in kbps (recommended: 4000-8000)
- **AUDIO_BITRATE** - Audio bitrate in kbps (recommended: 128-192)

## Limitations

- **Single stream per server** - One active Go Live per Discord guild
- **Self-bot risks** - Account may be banned by Discord
- **Network bandwidth** - Requires good upload speed for high quality streams

## License

MIT
