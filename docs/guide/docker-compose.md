# Docker Compose

The easiest way to deploy SchroStream with all dependencies.

## Basic Setup

Create a `docker-compose.yml`:

```yaml
version: '3.8'

services:
  schrostream:
    image: ghcr.io/moderniselife/schrostream:latest
    container_name: schrostream
    restart: unless-stopped
    environment:
      - DISCORD_TOKEN=${DISCORD_TOKEN}
      - PLEX_URL=${PLEX_URL}
      - PLEX_TOKEN=${PLEX_TOKEN}
      - COMMAND_PREFIX=!
      - DEFAULT_QUALITY=1080
      - MAX_BITRATE=8000
    volumes:
      - ./data:/app/data
```

Create a `.env` file:
```env
DISCORD_TOKEN=your_token
PLEX_URL=http://192.168.1.100:32400
PLEX_TOKEN=your_plex_token
```

Start:
```bash
docker-compose up -d
```

## With Local Plex

If you're running Plex in Docker too:

```yaml
version: '3.8'

services:
  plex:
    image: plexinc/pms-docker
    container_name: plex
    network_mode: host
    environment:
      - TZ=Australia/Sydney
      - PLEX_CLAIM=claim-xxx
    volumes:
      - ./plex/config:/config
      - /media:/media

  schrostream:
    image: ghcr.io/moderniselife/schrostream:latest
    container_name: schrostream
    restart: unless-stopped
    network_mode: host
    environment:
      - DISCORD_TOKEN=${DISCORD_TOKEN}
      - PLEX_URL=http://localhost:32400
      - PLEX_TOKEN=${PLEX_TOKEN}
    volumes:
      - ./data:/app/data
    depends_on:
      - plex
```

## With Cloud Mounts (zurg/rclone)

```yaml
version: '3.8'

services:
  zurg:
    image: ghcr.io/debridmediamanager/zurg-testing:latest
    container_name: zurg
    restart: unless-stopped
    volumes:
      - ./zurg/config.yml:/app/config.yml
      - ./zurg/data:/app/data

  rclone:
    image: rclone/rclone:latest
    container_name: rclone
    restart: unless-stopped
    cap_add:
      - SYS_ADMIN
    devices:
      - /dev/fuse
    security_opt:
      - apparmor:unconfined
    command: mount zurg: /data --allow-other --vfs-cache-mode full
    volumes:
      - ./rclone:/config/rclone
      - /mnt/media:/data:shared
    depends_on:
      - zurg

  plex:
    image: plexinc/pms-docker
    container_name: plex
    network_mode: host
    environment:
      - TZ=Australia/Sydney
    volumes:
      - ./plex:/config
      - /mnt/media:/media:ro
    depends_on:
      - rclone

  schrostream:
    image: ghcr.io/moderniselife/schrostream:latest
    container_name: schrostream
    restart: unless-stopped
    network_mode: host
    environment:
      - DISCORD_TOKEN=${DISCORD_TOKEN}
      - PLEX_URL=http://localhost:32400
      - PLEX_TOKEN=${PLEX_TOKEN}
    volumes:
      - ./schrostream/data:/app/data
    depends_on:
      - plex
```

## Commands

```bash
# Start
docker-compose up -d

# View logs
docker-compose logs -f schrostream

# Stop
docker-compose down

# Update
docker-compose pull
docker-compose up -d

# Rebuild from source
docker-compose build --no-cache
docker-compose up -d
```

## Building from Source

```yaml
version: '3.8'

services:
  schrostream:
    build: .
    container_name: schrostream
    restart: unless-stopped
    env_file: .env
    volumes:
      - ./data:/app/data
```

```bash
docker-compose build
docker-compose up -d
```
