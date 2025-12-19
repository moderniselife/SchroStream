# Node.js base with FFmpeg (Bun has zeromq/libuv compatibility issues)
FROM node:20-bookworm-slim

# Install FFmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Install tsx globally for running TypeScript
RUN npm install -g tsx

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies with npm
RUN npm install --production=false

# Copy source
COPY . .

# Build TypeScript
RUN npm run build

# Create data directory
RUN mkdir -p /app/data

# Set environment
ENV NODE_ENV=production

# Volume for persistent data
VOLUME ["/app/data"]

# Run the app
CMD ["npm", "start"]
