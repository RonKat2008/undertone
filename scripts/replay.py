"""Replay a recorded session fixture against a running backend."""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import httpx


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--file", default="fixtures/demo_session.jsonl", help="JSONL fixture path")
    p.add_argument("--url", default="http://localhost:8000", help="backend base URL")
    p.add_argument("--coach", default=None, help="coach_id (default: null)")
    p.add_argument("--speed", type=float, default=1.0, help="playback speed multiplier")
    p.add_argument("--no-stop", action="store_true", help="do not call /session/stop at the end")
    return p.parse_args()


def load_events(path: Path) -> list[dict]:
    events: list[dict] = []
    for n, line in enumerate(path.read_text().splitlines(), 1):
        line = line.strip()
        if not line:
            continue
        try:
            events.append(json.loads(line))
        except json.JSONDecodeError as exc:
            sys.exit(f"{path}:{n}: invalid JSON: {exc}")
    return events


def main() -> int:
    args = parse_args()
    if args.speed <= 0:
        print("--speed must be > 0", file=sys.stderr)
        return 2
    path = Path(args.file)
    if not path.is_file():
        print(f"fixture not found: {path}", file=sys.stderr)
        return 2
    events = load_events(path)
    base = args.url.rstrip("/")

    with httpx.Client(timeout=10.0) as client:
        try:
            resp = client.post(
                f"{base}/session/start",
                json={"coach_id": args.coach, "mode": "regular"},
            )
        except httpx.TransportError as exc:
            print(f"cannot reach server at {base}: {exc}", file=sys.stderr)
            return 1
        print(f"session/start {resp.status_code}: {resp.text}")
        if not resp.is_success:
            return 1

        t0 = time.monotonic()
        for ev in events:
            at = float(ev.get("at", 0.0))
            event = {k: v for k, v in ev.items() if k != "at"}
            delay = t0 + at / args.speed - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            try:
                r = client.post(f"{base}/dev/publish", json=event)
            except httpx.TransportError as exc:
                print(f"publish failed at {at:.1f}s: {exc}", file=sys.stderr)
                continue
            label = event.get("turn_id") or event.get("state") or ""
            print(f"[{at:6.1f}s] {event.get('type')} {label}".rstrip())
            if not r.is_success:
                print(f"  ! HTTP {r.status_code}: {r.text}")

        if not args.no_stop:
            time.sleep(1.5)
            try:
                r = client.post(f"{base}/session/stop", timeout=30.0)
            except httpx.TransportError as exc:
                print(f"session/stop failed: {exc}", file=sys.stderr)
                return 1
            try:
                print(json.dumps(r.json(), indent=2))
            except ValueError:
                print(f"session/stop {r.status_code}: {r.text}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
