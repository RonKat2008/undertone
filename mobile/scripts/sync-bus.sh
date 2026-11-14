#!/usr/bin/env bash
# The pure bus files are identical in both apps. Edit them in dashboard/lib/bus, then run this.
# contracts.ts itself comes from contracts/events.ts (the source of truth).
set -euo pipefail
cd "$(dirname "$0")/../.."
cp contracts/events.ts dashboard/lib/bus/contracts.ts
for f in contracts patterns types sample mock-script mock-source reducer; do
  cp "dashboard/lib/bus/$f.ts" "mobile/src/bus/$f.ts"
done
echo "synced contracts + 6 shared bus files"
