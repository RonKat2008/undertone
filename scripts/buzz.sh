#!/usr/bin/env bash
# Buzz the paired phone from the command line (Phase 1 checkpoint: "buzz the phone from curl").
#
#   scripts/buzz.sh                      # one "tap"
#   scripts/buzz.sh slow_down "Slow down"
#   scripts/buzz.sh all                  # every pattern, 2 s apart
#   scripts/buzz.sh pair                 # make a pairing and print the code for the phone
#   scripts/buzz.sh devices              # who is paired / connected
#
# Runs against the laptop's own backend (UNDERTONE_URL, default http://localhost:8000) through
# POST /haptics/test, which needs no key from the laptop itself. To go through the public API
# like a third-party app instead, set UNDERTONE_APP_KEY to an approved app key.
set -euo pipefail

URL="${UNDERTONE_URL:-http://localhost:8000}"
PATTERNS=(tap interrupt filler wrap_up slow_down still success approve status_good status_talking status_ask)

buzz() {
  local pattern="$1" label="${2:-$1}" body
  body=$(printf '{"pattern":"%s","label":"%s"}' "$pattern" "$label")
  if [[ -n "${UNDERTONE_APP_KEY:-}" ]]; then
    curl -sS -X POST "$URL/v1/haptics" -H "Authorization: Bearer $UNDERTONE_APP_KEY" \
      -H 'Content-Type: application/json' -d "$body"
  else
    curl -sS -X POST "$URL/haptics/test" -H 'Content-Type: application/json' -d "$body"
  fi
  echo
}

case "${1:-tap}" in
  pair)    curl -sS -X POST "$URL/pair" -H 'Content-Type: application/json' -d '{}'; echo ;;
  devices) curl -sS "$URL/devices"; echo ;;
  all)     for p in "${PATTERNS[@]}"; do echo "-> $p"; buzz "$p"; sleep 2; done ;;
  -h|--help) sed -n '2,13p' "$0" ;;
  *)       buzz "$1" "${2:-}" ;;
esac
