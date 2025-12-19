# Configuration

SchroStream is configured through environment variables. Create a `.env` file in the project root.

## Required Settings

```env
# Discord user token (see Discord Token guide)
DISCORD_TOKEN=your_discord_token_here

# Plex server URL and token (see Plex Token guide)
PLEX_URL=http://192.168.1.100:32400
PLEX_TOKEN=your_plex_token_here
```

## Optional Settings

### Discord Settings

```env
# Command prefix (default: !)
COMMAND_PREFIX=!

# Allowed users - comma-separated Discord user IDs
# Leave empty to allow only the bot account
ALLOWED_USERS=123456789012345678,987654321098765432

# Allowed roles - comma-separated Discord role IDs
# Users with these roles can control the bot
ALLOWED_ROLES=123456789012345678,987654321098765432

# Allowed guilds - comma-separated Discord server IDs
# Bot only responds in these servers (leave empty for all)
ALLOWED_GUILDS=123456789012345678
```

### Stream Settings

```env
# Default video quality (height in pixels)
# Options: 480, 720, 1080, 1440 (default: 1080)
# Discord Nitro max: 1440p
DEFAULT_QUALITY=1080

# Maximum video bitrate in kbps
# Recommended: 8000 (1080p30), 10000 (1080p60), 15000 (1440p60)
MAX_BITRATE=10000

# Audio bitrate in kbps (default: 256)
AUDIO_BITRATE=256

# Frame rate (30 or 60 - 60 requires Discord Nitro)
FRAME_RATE=30
```

### Plex Settings

```env
# Plex client identifier (default: SchroStream)
PLEX_CLIENT_IDENTIFIER=SchroStream
```

## Example Configuration

Here's a complete `.env` example:

```env
# Discord
DISCORD_TOKEN=MTIzNDU2Nzg5.ABcDeF.xyz123
COMMAND_PREFIX=!
ALLOWED_USERS=
ALLOWED_ROLES=123456789012345678
ALLOWED_GUILDS=987654321098765432

# Plex
PLEX_URL=http://192.168.1.100:32400
PLEX_TOKEN=abc123xyz789
PLEX_CLIENT_IDENTIFIER=SchroStream

# Stream Quality (Discord Nitro: up to 1440p 60fps)
DEFAULT_QUALITY=1080
MAX_BITRATE=10000
AUDIO_BITRATE=256
FRAME_RATE=30
```

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DISCORD_TOKEN` | Yes | - | Your Discord user token |
| `PLEX_URL` | Yes | - | Plex server URL |
| `PLEX_TOKEN` | Yes | - | Plex authentication token |
| `COMMAND_PREFIX` | No | `!` | Bot command prefix |
| `ALLOWED_USERS` | No | Bot owner | Comma-separated user IDs |
| `ALLOWED_ROLES` | No | - | Comma-separated role IDs |
| `ALLOWED_GUILDS` | No | All | Comma-separated guild IDs |
| `DEFAULT_QUALITY` | No | `1080` | Video height (480, 720, 1080, 1440) |
| `MAX_BITRATE` | No | `10000` | Max video bitrate (kbps) |
| `AUDIO_BITRATE` | No | `256` | Audio bitrate (kbps) |
| `FRAME_RATE` | No | `30` | Frame rate (30 or 60) |
| `PLEX_CLIENT_IDENTIFIER` | No | `SchroStream` | Plex client ID |
