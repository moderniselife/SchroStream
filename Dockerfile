# Build stage
FROM oven/bun:latest AS base
WORKDIR /app

# Install dependencies
FROM base AS install
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# Release stage
FROM base AS release

# Install FFmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Copy dependencies
COPY --from=install /app/node_modules ./node_modules

# Copy source
COPY . .

# Build TypeScript
RUN bun run build

# Create data directory
RUN mkdir -p /app/data

# Set environment
ENV NODE_ENV=production

# Volume for persistent data
VOLUME ["/app/data"]

# Run the app
CMD ["bun", "start"]
