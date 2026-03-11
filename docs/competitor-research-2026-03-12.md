# Competitor Research: StreamBot vs SchroStream

**Date:** 2026-03-12
**Researcher:** Cascade AI
**Objective:** Determine why competitor's Discord video streaming works while SchroStream's stopped working

## Key Finding: Same Library, Different Usage

Both projects use **identical library versions**:
- `@dank074/discord-video-stream` v6.0.0 (our `^5.0.2` in package.json resolved to 6.0.0 by bun)
- `discord.js-selfbot-v13` v3.7.1

The streaming failure was caused by **how we use the library**, not a version difference.

## Root Causes Identified

### 1. Container Format Mismatch (Critical)

The library's `playStream` function defaults to demuxing with `format: "nut"` (NUT container). Our manual FFmpeg outputs `-f matroska` (Matroska container). The libav demuxer was told to expect NUT but received Matroska data — causing silent demux failure.

**Competitor:** Uses `prepareStream()` from the library which automatically outputs in `nut` format, perfectly matching `playStream`'s expectations.

**SchroStream:** Manually spawns FFmpeg with `-f matroska` output, then passes raw stdout to `playStream` without specifying the format.

**Fix:** Pass `{ type: 'go-live', format: 'matroska' }` to all `playStream` calls so the demuxer knows to expect Matroska.

### 2. Voice Connection Timing (Contributing)

**Competitor:** Waits 2000ms after joining voice, then verifies `streamer.voiceConnection` exists before proceeding. Only joins if not already connected.

**SchroStream:** Was waiting only 300ms with no verification. `joinVoice` could hang indefinitely with no timeout.

**Fix:** Increased delay to 2×1000ms (1s pre-join + 1s post-join), added 15s timeout on `joinVoice`, added `voiceConnection` verification.

### 3. FFmpeg Management

**Competitor:** Uses library's `prepareStream()` which handles FFmpeg via `fluent-ffmpeg` with proper codec settings, encoder presets, and `AbortController` for clean cancellation.

**SchroStream:** Manually spawns FFmpeg via `child_process.spawn` with hand-crafted arguments. More flexible (supports subtitle burning, GPU transcoding, speed control, music visualiser) but more brittle.

**No change needed** — our manual approach is required for advanced features. The format fix resolves the compatibility issue.

## Architecture Comparison

| Aspect | Competitor (StreamBot) | SchroStream |
|---|---|---|
| **Library version** | `@dank074/discord-video-stream` 6.0.0 | Same (resolved to 6.0.0) |
| **FFmpeg handling** | Library's `prepareStream()` | Manual `spawn('ffmpeg', ...)` |
| **Output format** | `nut` (automatic via library) | `matroska` (manual flag) |
| **Voice connection** | Join once, stay connected, 2s wait, verify | Leave/rejoin each time, 1s+1s wait, verify (after fix) |
| **Stream cancellation** | `AbortController` signal | Manual `kill()` on FFmpeg process |
| **GPU transcoding** | No | Yes (NVENC) |
| **Subtitle burning** | No | Yes |
| **Speed control** | No | Yes |
| **Music visualiser** | No | Yes |
| **Pause screen** | No | Yes (frozen frame) |
| **Plex integration** | No | Yes |

## Changes Made

1. **`src/stream/video-streamer.ts`** — All `playStream` calls now pass `format: 'matroska'`
2. **`src/stream/video-streamer.ts`** — All `startX` methods now: leave/1s delay/join/1s wait/verify voiceConnection
3. **`src/stream/video-streamer.ts`** — All `joinVoice` calls wrapped in 15s timeout
4. **`src/controller/bot.ts`** — Defensive logging and error handling around post-download flow

## Future Considerations

- Consider migrating simple stream cases to use `prepareStream()` with `customFfmpegFlags` for better library compatibility
- The competitor uses `AbortController` for clean cancellation — worth adopting for our stream management
- The library's `Encoders.nvenc()` and `Encoders.software()` could simplify our GPU transcoding logic
