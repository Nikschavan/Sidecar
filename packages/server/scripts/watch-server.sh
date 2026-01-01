#!/bin/bash
# Auto-restart wrapper for the Sidecar server
# Restarts the server automatically when it exits

cd "$(dirname "$0")/.."

while true; do
  echo "Starting server..."
  node dist/index.js
  EXIT_CODE=$?
  echo "Server exited with code $EXIT_CODE. Restarting in 1s..."
  sleep 1
done
