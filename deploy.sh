#!/bin/bash

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Emojis
INFO="ℹ️"
SUCCESS="✅"
WARNING="⚠️"
ERROR="❌"
ROCKET="🚀"
FOLDER="📁"
FILES="📄"
GEAR="⚙️"
DOCKER="🐳"

# Configuration
REMOTE_USER="joseph"
REMOTE_HOST="192.168.1.124"
REMOTE_DIR="/home/joseph/SchroStream"
SSH_PORT=22
MAIN_REPO_DIR="/Users/josephshenton/SchroStream"

# Files to copy to the server
FILES=("docker-compose.yml" "Dockerfile" "src/" "web/" "vite.config.ts" "package.json" "tsconfig.json")

# Function to print section headers
section() {
    echo -e "\n${BLUE}${GEAR} $1 ${NC}\n"
}

# Function to print success messages
success() {
    echo -e "${GREEN}${SUCCESS} $1${NC}"
}

# Function to print info messages
info() {
    echo -e "${BLUE}${INFO} $1${NC}"
}

# Function to print warning messages
warning() {
    echo -e "${YELLOW}${WARNING} $1${NC}"
}

# Function to print error messages
error() {
    echo -e "${RED}${ERROR} $1${NC}"
}

section "🚀 Starting Deployment"

# Check if required commands exist
info "Checking system requirements..."
if ! command -v ssh &> /dev/null; then
    error "SSH is required but not installed. Please install it first."
    exit 1
fi

if ! command -v scp &> /dev/null; then
    error "SCP is required but not installed. Please install it first."
    exit 1
fi

if ! command -v rsync &> /dev/null; then
    warning "rsync not found. Using scp for directory transfers (slower)."
    USE_SCP_FOR_DIRS=true
fi

# Create remote directory and clean up old files
info "Preparing remote directory..."
ssh -p $SSH_PORT $REMOTE_USER@$REMOTE_HOST "mkdir -p $REMOTE_DIR && cd $REMOTE_DIR && rm -rf bot controller data netflix plex stream types youtube web index.ts config.ts *.md *.lock *.html tsconfig.node.json vite.config.ts tailwind.config.js postcss.config.js public scripts docs .github assets bun.lock www.netflix.com.har" && 
    success "Remote directory ready" || 
    { error "Failed to prepare remote directory"; exit 1; }

# Copy necessary files
section "📤 Uploading files..."
for file in "${FILES[@]}"; do
    if [[ -d "$file" ]]; then
        if [ "$USE_SCP_FOR_DIRS" = true ]; then
            info "Copying directory: $file (using scp)..."
            scp -r -P $SSH_PORT "$file" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/" &&
                success "  └─ Successfully copied $file" ||
                { error "  └─ Failed to copy $file"; exit 1; }
        else
            info "Syncing directory: $file"
            # Remove trailing slash to preserve directory structure
            source_dir="${file%/}"
            rsync -avz --progress --exclude='.env' --exclude='.env.*' -e "ssh -p $SSH_PORT" "$source_dir" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/" &&
                success "  └─ Successfully synced $file" ||
                { error "  └─ Failed to sync $file"; exit 1; }
        fi
    else
        info "Copying file: $file"
        scp -P $SSH_PORT "$file" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/" &&
            success "  └─ Successfully copied $file" ||
            { error "  └─ Failed to copy $file"; exit 1; }
    fi
done

# Copy .env from main repository LAST to ensure it's not overwritten
info "Copying .env from main repository..."
scp -P $SSH_PORT "$MAIN_REPO_DIR/.env" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_DIR/" &&
    success "  └─ Successfully copied .env" ||
    { error "  └─ Failed to copy .env"; exit 1; }

# Deploy the stack
# Deploy the stack
section "🚀 Deploying Docker stack..."
ssh -p $SSH_PORT $REMOTE_USER@$REMOTE_HOST "
    echo -e '\n${BLUE}${DOCKER} Changing to project directory...${NC}'
    cd $REMOTE_DIR || { echo -e '${RED}${ERROR} Failed to change directory${NC}'; exit 1; }
    
    # Stop and remove existing containers
    echo -e '\n${YELLOW}${WARNING} Stopping existing containers...${NC}'
    docker compose down || { echo -e '${RED}${ERROR} Failed to stop containers${NC}'; exit 1; }
    
    # Pull latest images
    echo -e '\n${BLUE}${INFO} Pulling latest images...${NC}'
    docker compose pull || { echo -e '${YELLOW}${WARNING} Failed to pull some images, continuing...${NC}'; }
    
    # Build and start containers
    echo -e '\n${GREEN}${ROCKET} Building and starting containers...${NC}'
    docker compose up -d --build
    
    if [ \$? -eq 0 ]; then
        echo -e '\n${GREEN}${SUCCESS} Deployment completed successfully!${NC}'
        echo -e \"${BLUE}${INFO} Containers status:\"
        docker compose ps
    else
        echo -e '\n${RED}${ERROR} Deployment failed!${NC}'
        echo -e \"\\n${YELLOW}${WARNING} Last 20 lines of logs:${NC}\"
        docker compose logs --tail=20
        exit 1
    fi
"

if [ $? -eq 0 ]; then
    success "Deployment finished successfully!"
    echo -e \"\\n${GREEN}${SUCCESS} Your application is now running on ${REMOTE_HOST} ${NC}\"
else
    error "Deployment failed. Check the error messages above."
    exit 1
fi