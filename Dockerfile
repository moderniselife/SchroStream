# Ubuntu base with Bun and FFmpeg
FROM ubuntu:24.04

# Install dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    unzip \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

WORKDIR /app

# Copy package files
COPY package.json bun.lock ./

# Install dependencies
RUN bun install --frozen-lockfile --production

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
