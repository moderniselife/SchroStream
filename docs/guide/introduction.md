# What is SchroStream?

SchroStream is a Discord self-bot that streams content from your Plex media server directly to Discord voice channels using Discord's "Go Live" feature.

## Features

- **Stream Movies & TV Shows** - Play any content from your Plex library
- **Full Playback Controls** - Pause, resume, seek, skip, and volume control
- **Episode Selection** - Browse and select specific episodes of TV shows
- **Resume Playback** - Automatically saves your position and offers to resume
- **Multi-User Support** - Configure which users and roles can control the bot
- **Cloud Mount Compatible** - Works with zurg, rclone, and other cloud mounts via HLS transcoding

## How It Works

1. The bot connects to Discord as a self-bot (using your account token)
2. When you request media, it fetches the stream from your Plex server
3. FFmpeg transcodes the stream to a format compatible with Discord
4. The bot streams to Discord using the Go Live feature
5. Anyone in the voice channel can watch!

## Important Notes

::: warning Self-Bot Notice
SchroStream is a **self-bot** that uses your Discord account token. Self-bots are against Discord's Terms of Service. Use at your own risk.
:::

::: tip Plex Pass Not Required
SchroStream uses Plex's transcode API and works without Plex Pass. However, having Plex Pass may improve transcoding performance.
:::

## Requirements

- Node.js 18+ or Bun
- FFmpeg with libx264 and libopus
- A Plex Media Server
- A Discord account
