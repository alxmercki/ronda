#!/bin/bash

PORT=8371
APP_DIR="$(cd "$(dirname "$0")" && pwd)"

# Kill any previous instance on this port
lsof -ti tcp:$PORT | xargs kill -9 2>/dev/null

# Start Node web app server in background
cd "$APP_DIR"
PORT=$PORT HOST=127.0.0.1 node server.js &
SERVER_PID=$!

# Wait for server to be ready
sleep 0.8

# Open in Chrome as app window (standalone, no tabs/address bar)
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
if [ -f "$CHROME" ]; then
  "$CHROME" --app=http://localhost:$PORT --user-data-dir="$HOME/.ronda-chrome-profile" 2>/dev/null &
else
  open "http://localhost:$PORT"
fi

# Keep script alive; kill server when window closes
wait $SERVER_PID
