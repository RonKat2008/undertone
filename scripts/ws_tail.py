"""Tail the backend WebSocket and print each event as one compact line."""
from __future__ import annotations

import argparse
import asyncio
import json
from datetime import datetime
from typing import Any

import websockets


def _judge_result(v: Any) -> str:
    if isinstance(v, dict):
        if "p" in v:
            return f"p={round(float(v['p']), 2)}"
        if "choice" in v:
            return str(v["choice"])
        if "score" in v:
            return str(round(float(v["score"]), 1))
    return json.dumps(v)[:30]


def summarize(m: dict[str, Any]) -> str:
    t = m.get("type")
    g = m.get
    if t == "turn.final":
        return f"{g('speaker')} {g('turn_id')} {str(g('text', ''))[:60]!r}"
    if t == "judge":
        res = " ".join(f"{k}={_judge_result(v)}" for k, v in (g("results") or {}).items())
        return f"{g('turn_id')} {g('source')} {g('latency_ms')}ms {res}"
    if t == "metrics":
        keys = ("talk_ratio", "wpm", "monologue_s", "fillers_per_min", "interruptions", "questions")
        return " ".join(f"{k}={g(k)}" for k in keys)
    if t == "nudge":
        return (f"{g('rule_id')} haptic={g('haptic')} {g('message')!r} "
                f"{g('latency_ms')}ms budget_left={g('budget_left')}")
    if t == "status.reply":
        return str(g("verdict"))
    if t == "bookmark":
        return f"{g('source')} {g('text')}"
    if t == "debrief":
        return f"{(g('data') or {}).get('headline_fact')} audio={g('audio_url')}"
    return json.dumps(m)[:160]


async def tail(args: argparse.Namespace) -> None:
    wanted = {s.strip() for s in args.types.split(",") if s.strip()} if args.types else None
    seen = 0
    while True:
        try:
            async with websockets.connect(args.url) as ws:
                print(f"connected to {args.url}", flush=True)
                async for raw in ws:
                    try:
                        msg = json.loads(raw)
                    except ValueError:
                        print(f"{datetime.now():%H:%M:%S.%f}"[:12], "raw", str(raw)[:160])
                        continue
                    t = msg.get("type") if isinstance(msg, dict) else None
                    if (wanted and t not in wanted) or (args.quiet_metrics and t == "metrics"):
                        continue
                    ts = datetime.now().strftime("%H:%M:%S.%f")[:-3]
                    print(f"{ts} {t} {summarize(msg) if isinstance(msg, dict) else msg}", flush=True)
                    seen += 1
                    if args.count and seen >= args.count:
                        return
        except (OSError, websockets.WebSocketException) as exc:
            print(f"disconnected ({exc}); retrying in 1s", flush=True)
        await asyncio.sleep(1)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--url", default="ws://localhost:8000/ws")
    p.add_argument("--types", default="", help="comma list of event types to show")
    p.add_argument("--quiet-metrics", action="store_true", help="skip metrics events")
    p.add_argument("--count", type=int, default=0, help="exit after N messages (0 = forever)")
    args = p.parse_args()
    try:
        asyncio.run(tail(args))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
