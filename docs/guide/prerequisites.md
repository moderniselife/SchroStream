# Prerequisites

Before installing SchroStream, ensure you have the following:

## System Requirements

### Node.js or Bun

SchroStream requires either:
- **Bun** 1.0+ (recommended for performance)
- **Node.js** 18.0+

Check your version:
```bash
bun --version
# or
node --version
```

### FFmpeg

FFmpeg is required for video transcoding. It must be compiled with:
- `libx264` - H.264 video encoding
- `libopus` - Opus audio encoding

#### Install FFmpeg

**macOS:**
```bash
brew install ffmpeg
```

**Ubuntu/Debian:**
```bash
sudo apt update
sudo apt install ffmpeg
```

**Windows:**
Download from [ffmpeg.org](https://ffmpeg.org/download.html) and add to PATH.

**Verify installation:**
```bash
ffmpeg -version
```

## Plex Media Server

You need access to a Plex Media Server with:
- Media libraries configured
- Network access from where SchroStream runs
- A Plex account (Plex Pass not required)

## Discord Account

You need a Discord account to:
- Generate a user token (self-bot)
- Be a member of the server(s) where you want to stream

::: warning Account Risk
Using self-bots violates Discord's ToS. Consider using an alt account.
:::

## Network Requirements

- SchroStream must be able to reach your Plex server
- For cloud mounts (zurg/rclone), HLS transcoding is used automatically
- Sufficient bandwidth for streaming (8+ Mbps recommended)
