# Python Selfbot Migration

> **Branch:** `python_selfbot_migration`
> **Date:** 2025-03-04
> **Status:** In Progress

## Why

Discord broke `discord.js-selfbot-v13` (the Node.js selfbot library). The gateway
connection no longer works, which means:

1. The selfbot can't log in to Discord
2. Message commands (`!play`, `!search`, etc.) don't work
3. Video streaming via `@dank074/discord-video-stream` also fails (it depends on the selfbot client)

## Architecture

The migration converts **only the selfbot** to Python using
[discord.py-self](https://github.com/dolfies/discord.py-self). Everything else
stays in TypeScript.

```
┌─────────────────────────┐     HTTP IPC      ┌──────────────────────────┐
│   Python Selfbot        │ ──────────────►   │   TypeScript Backend     │
│   (discord.py-self)     │   localhost:3105   │                          │
│                         │                    │  ├─ Video Streamer       │
│  ├─ Discord gateway     │                    │  ├─ Plex Client          │
│  ├─ Message commands    │                    │  ├─ YouTube Downloader   │
│  ├─ Permission checks   │                    │  ├─ Web Server + UI     │
│  └─ User activity       │                    │  ├─ Controller Bot (d.js)│
│                         │                    │  ├─ Queue / Watch Deck   │
└─────────────────────────┘                    │  └─ Cast Receivers       │
                                               └──────────────────────────┘
```

### What moved to Python
- `src/bot/client.ts` → `selfbot/client.py`
- `src/bot/commands/*` → `selfbot/commands/*`

### What stayed in TypeScript
- `src/stream/video-streamer.ts` — Video streaming (Go Live)
- `src/controller/bot.ts` — Controller bot (slash commands via discord.js)
- `src/plex/*` — Plex integration
- `src/youtube/*` — YouTube downloading
- `src/web/server.ts` — Web server + IPC API
- `src/data/*` — Queue, watch deck, storage
- `src/cast/*` — Cast receivers

### IPC Bridge
The TypeScript web server exposes `/api/ipc/*` endpoints that the Python selfbot
calls via HTTP. See `src/web/ipc-routes.ts` for the full API.

## File Structure

```
selfbot/
├── __init__.py
├── run.py              # Entry point (python -m selfbot.run)
├── client.py           # SchroStreamBot — discord.py-self client
├── config.py           # Reads .env (same file as TS backend)
├── helpers.py           # Shared utilities (time parsing, progress bars)
├── ipc.py              # HTTP client for TS backend communication
├── requirements.txt    # Python dependencies
└── commands/
    ├── __init__.py
    ├── registry.py     # Command name → handler mapping
    ├── help.py
    ├── search.py
    ├── play.py
    ├── stop.py
    ├── pause.py
    ├── seek.py
    ├── skip.py
    ├── nowplaying.py
    ├── volume.py
    ├── speed.py
    ├── ffwd.py
    ├── episodes.py
    ├── random_cmd.py
    ├── ondeck.py
    ├── queue.py
    ├── youtube.py
    ├── url.py
    ├── ytsearch.py
    ├── ytrending.py
    └── ytmusic.py
```

## Running Locally

```bash
# Terminal 1: Start the TypeScript backend
bun run start

# Terminal 2: Start the Python selfbot
pip install -r selfbot/requirements.txt
python -m selfbot.run
```

## Running in Docker

The Dockerfile installs both Node.js and Python dependencies.
`scripts/start.sh` launches both processes and waits for either to exit.

```bash
docker compose up --build
```

## Known Limitations / TODO

- **Video streaming:** The `@dank074/discord-video-stream` library still depends
  on `discord.js-selfbot-v13` for voice connections. If this is also broken,
  video streaming needs to be reimplemented using `discord.py-self`'s voice
  support or a Python equivalent.
- **Netflix command:** Not yet ported (was using Playwright in TS).
- **Voice commands:** Not yet ported (was using Python subprocess already).
- **Activity status:** The Python bot sets its own activity; the TS backend
  status updates in `video-streamer.ts` that import the old selfbot client
  will need updating.
