# Docker

Run SchroStream in a Docker container.

## Quick Start

### Pull and Run

```bash
docker run -d \
  --name schrostream \
  -e DISCORD_TOKEN=your_token \
  -e PLEX_URL=http://192.168.1.100:32400 \
  -e PLEX_TOKEN=your_plex_token \
  -v schrostream-data:/app/data \
  ghcr.io/moderniselife/schrostream:latest
```

### Build Locally

```bash
git clone https://github.com/moderniselife/SchroStream.git
cd schrostream
docker build -t schrostream .
```

Run:
```bash
docker run -d \
  --name schrostream \
  --env-file .env \
  -v schrostream-data:/app/data \
  schrostream
```

## Environment Variables

Pass environment variables with `-e` or `--env-file`:

```bash
docker run -d \
  --name schrostream \
  -e DISCORD_TOKEN=xxx \
  -e PLEX_URL=http://plex:32400 \
  -e PLEX_TOKEN=xxx \
  -e COMMAND_PREFIX=! \
  -e DEFAULT_QUALITY=1080 \
  -e MAX_BITRATE=8000 \
  schrostream
```

Or use an env file:
```bash
docker run -d \
  --name schrostream \
  --env-file .env \
  schrostream
```

## Volumes

Mount a volume for persistent data (playback positions):

```bash
-v /path/to/data:/app/data
# or
-v schrostream-data:/app/data
```

## Networking

### Access Local Plex Server

If Plex is running on the host:
```bash
docker run -d \
  --name schrostream \
  --network host \
  --env-file .env \
  schrostream
```

Or use host IP:
```bash
-e PLEX_URL=http://192.168.1.100:32400
```

### Access Plex in Another Container

```bash
docker network create media
docker run -d --name plex --network media plex
docker run -d --name schrostream --network media -e PLEX_URL=http://plex:32400 schrostream
```

## Commands

```bash
# View logs
docker logs -f schrostream

# Stop
docker stop schrostream

# Start
docker start schrostream

# Remove
docker rm -f schrostream

# Update
docker pull ghcr.io/moderniselife/schrostream:latest
docker rm -f schrostream
# Run again with same command
```

## Dockerfile Reference

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS release
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*
COPY --from=install /app/node_modules ./node_modules
COPY . .
RUN bun run build

ENV NODE_ENV=production
VOLUME ["/app/data"]
CMD ["bun", "start"]
```
