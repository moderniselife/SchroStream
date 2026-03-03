#!/bin/bash
# Start both the TypeScript backend and Python selfbot.
#
# The TS backend handles: video streaming, Plex, YouTube, web server, controller bot.
# The Python selfbot handles: Discord gateway connection and message commands.
#
# The Python selfbot communicates with the TS backend via HTTP IPC on localhost.

set -e

echo "╔═══════════════════════════════════════╗"
echo "║     SchroStream Launcher              ║"
echo "║   TS Backend + Python Selfbot         ║"
echo "╚═══════════════════════════════════════╝"
echo ""

# Start the TypeScript backend in the background
echo "[Launcher] Starting TypeScript backend..."
npm start &
TS_PID=$!

# Wait for the web server to be ready before starting the Python selfbot
echo "[Launcher] Waiting for TS backend (port ${WEB_PORT:-3105})..."
for i in $(seq 1 30); do
    if curl -sf "http://localhost:${WEB_PORT:-3105}/api/streams" > /dev/null 2>&1; then
        echo "[Launcher] TS backend is ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "[Launcher] WARNING: TS backend did not respond in 30s, starting selfbot anyway"
    fi
    sleep 1
done

# Start the Python selfbot
echo "[Launcher] Starting Python selfbot..."
python3 -m selfbot.run &
PY_PID=$!

echo "[Launcher] Both processes started (TS PID=$TS_PID, Python PID=$PY_PID)"

# Wait for either process to exit
wait -n $TS_PID $PY_PID
EXIT_CODE=$?

echo "[Launcher] A process exited with code $EXIT_CODE, shutting down..."

# Kill remaining processes
kill $TS_PID $PY_PID 2>/dev/null || true
wait $TS_PID $PY_PID 2>/dev/null || true

exit $EXIT_CODE
