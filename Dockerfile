# Node.js base with FFmpeg (Bun has zeromq/libuv compatibility issues)
FROM node:20-bookworm-slim

# Install FFmpeg, yt-dlp, and build tools for native modules
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg python3 curl ca-certificates \
    build-essential make g++ unzip wget && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    rm -rf /var/lib/apt/lists/*

# Install tsx globally for running TypeScript
RUN npm install -g tsx

WORKDIR /app

# Copy package files first for better caching
COPY package.json package-lock.json* ./

# Install dependencies with npm
RUN npm install --production=false

# Install vosk separately (needs native build)
RUN npm install vosk

# Copy the rest of the files
COPY . .

# Create data directory
RUN mkdir -p /app/data

# Download Vosk model for voice commands (small English model ~40MB)
RUN wget -q https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip && \
    unzip -q vosk-model-small-en-us-0.15.zip && \
    mv vosk-model-small-en-us-0.15 vosk-model && \
    rm vosk-model-small-en-us-0.15.zip

# Build TypeScript backend
RUN npm run build

# Build web frontend (outputs to /app/public)
RUN npm run build:web

# Set environment
ENV NODE_ENV=production

# Volume for persistent data
VOLUME ["/app/data"]

# Run the app
CMD ["npm", "start"]