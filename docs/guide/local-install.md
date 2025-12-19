# Local Installation

Run SchroStream directly on your machine without Docker.

## Prerequisites

- [Node.js 18+](https://nodejs.org/) or [Bun](https://bun.sh/)
- [FFmpeg](https://ffmpeg.org/) with libx264 and libopus
- Git

## Installation Steps

### 1. Clone the Repository

```bash
git clone https://github.com/moderniselife/SchroStream.git
cd schrostream
```

### 2. Install Dependencies

**Using Bun (recommended):**
```bash
bun install
```

**Using npm:**
```bash
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your configuration:
```env
DISCORD_TOKEN=your_token
PLEX_URL=http://192.168.1.100:32400
PLEX_TOKEN=your_plex_token
```

### 4. Build (Production)

```bash
bun run build
```

### 5. Start the Bot

**Development (with hot reload):**
```bash
bun dev
```

**Production:**
```bash
bun start
```

## Running as a Service

### systemd (Linux)

Create `/etc/systemd/system/schrostream.service`:

```ini
[Unit]
Description=SchroStream Discord Bot
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/schrostream
ExecStart=/usr/bin/bun start
Restart=always
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable schrostream
sudo systemctl start schrostream
```

### PM2

```bash
npm install -g pm2
pm2 start "bun start" --name schrostream
pm2 save
pm2 startup
```

## Updating

```bash
git pull
bun install
bun run build
# Restart the service
```
