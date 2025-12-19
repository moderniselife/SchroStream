# Getting Started

This guide will walk you through setting up SchroStream from scratch.

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/moderniselife/SchroStream.git
cd schrostream
```

### 2. Install Dependencies

Using Bun (recommended):
```bash
bun install
```

Or using npm:
```bash
npm install
```

### 3. Configure Environment

Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` with your settings:
```env
# Discord Configuration
DISCORD_TOKEN=your_discord_token_here

# Plex Configuration  
PLEX_URL=http://your-plex-server:32400
PLEX_TOKEN=your_plex_token_here
```

See [Discord Token](/guide/discord-token) and [Plex Token](/guide/plex-token) guides for how to obtain these.

### 4. Start the Bot

```bash
bun dev
```

Or for production:
```bash
bun start
```

### 5. Use the Bot

1. Join a Discord voice channel
2. Type `!search movie name` to find content
3. Type `!play 1` to start streaming
4. Enjoy!

## Next Steps

- [Prerequisites](/guide/prerequisites) - Detailed system requirements
- [Configuration](/guide/configuration) - All configuration options
- [Commands](/guide/commands) - Full command reference
- [Docker](/guide/docker) - Deploy with Docker
