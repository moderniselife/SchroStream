# NVIDIA CUDA base with Node.js for GPU transcoding support
# Falls back to CPU encoding if no GPU available
FROM nvidia/cuda:12.2.0-runtime-ubuntu22.04 AS base

# Install Node.js 20
RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates gnupg && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install FFmpeg with NVENC support, yt-dlp, fonts, and Python packages
# Using jellyfin-ffmpeg which includes full NVENC/NVDEC support
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    python3 python3-pip curl ca-certificates \
    build-essential make g++ unzip wget \
    portaudio19-dev python3-dev gcc \
    fonts-dejavu-core \
    # NVIDIA codec headers for NVENC
    libnvidia-encode-525 libnvidia-decode-525 && \
    # Install FFmpeg with NVENC support from jellyfin repo
    curl -fsSL https://repo.jellyfin.org/ubuntu/jellyfin_team.gpg.key | gpg --dearmor -o /etc/apt/keyrings/jellyfin.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/jellyfin.gpg] https://repo.jellyfin.org/ubuntu jammy main" | tee /etc/apt/sources.list.d/jellyfin.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends jellyfin-ffmpeg6 && \
    ln -sf /usr/lib/jellyfin-ffmpeg/ffmpeg /usr/local/bin/ffmpeg && \
    ln -sf /usr/lib/jellyfin-ffmpeg/ffprobe /usr/local/bin/ffprobe && \
    # Install Python packages
    pip3 install --break-system-packages SpeechRecognition pyaudio && \
    # Install yt-dlp
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

# Copy the rest of the files
COPY . .

# Create data directory
RUN mkdir -p /app/data

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