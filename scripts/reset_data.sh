#!/bin/zsh
# Reset Undertone to an empty state: stop the backend, move the database and recordings
# into a dated backup folder (nothing is deleted), then start the backend again.
# Usage: scripts/reset_data.sh
set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${UNDERTONE_ENV:-/Users/ronitkatikaneni/undertone/.env}"
BACKUP="${UNDERTONE_BACKUPS:-$HOME/undertone-backups}/reset-$(date +%Y%m%d-%H%M%S)"
LOG="${UNDERTONE_LOG:-$REPO/backend.log}"
PORT=8000

cd "$REPO" || exit 1

echo "Stopping the backend on port $PORT..."
lsof -ti ":$PORT" | xargs kill 2>/dev/null
sleep 2
lsof -ti ":$PORT" | xargs kill -9 2>/dev/null

mkdir -p "$BACKUP"
for f in undertone.db undertone.db-shm undertone.db-wal media; do
  [ -e "$f" ] && mv "$f" "$BACKUP/"
done
echo "Old data moved to $BACKUP"

if [ ! -f "$ENV_FILE" ]; then
  echo "No env file at $ENV_FILE; not starting the backend." >&2
  exit 1
fi

set -a; source "$ENV_FILE"; set +a
export PUBLIC_BACKEND_URL="http://$(ipconfig getifaddr en0):$PORT"
export BAND_TRANSPORT=ble ALWAYS_ON=1 DEMO_POLICY=1
nohup uv run uvicorn backend.main:app --host 0.0.0.0 --port "$PORT" > "$LOG" 2>&1 &

echo "Starting the backend (log: $LOG)..."
for _ in $(seq 1 30); do
  if curl -s -m 2 "localhost:$PORT/health" > /dev/null; then
    echo "Backend is up and empty. Next: open http://localhost:3000/settings#calibration"
    exit 0
  fi
  sleep 2
done
echo "The backend did not answer within 60 s. Check $LOG" >&2
exit 1
