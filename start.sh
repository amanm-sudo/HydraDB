#!/usr/bin/env bash
# One-liner to start the full blast-radius stack.
# Run from the project root (Windows Git Bash or WSL2).
# 
# IMPORTANT: HydraDB must already be running in a separate WSL2 terminal:
#   wsl -d Ubuntu -- bash scripts/start-hydradb.sh
#
# This script starts the API server + frontend dev server.

echo "Starting blast-radius API server (port 3001)..."
cd server && node index.js &
SERVER_PID=$!
cd ..

sleep 2

echo "Starting blast-radius frontend (port 3000)..."
cd web && npm run dev &
WEB_PID=$!
cd ..

echo ""
echo "======================================"
echo " blast-radius is running!"
echo "  Frontend: http://localhost:3000"
echo "  API:      http://localhost:3001"
echo "  HydraDB:  bolt://127.0.0.1:7687 (must be started separately)"
echo "======================================"
echo ""
echo "Press Ctrl+C to stop all processes."

trap "kill $SERVER_PID $WEB_PID 2>/dev/null; exit 0" INT
wait
