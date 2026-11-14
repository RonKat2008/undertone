"""Run Person A's whole stack without FastAPI and print every bus event as JSON lines.

    uv run python scripts/run_person_a.py                       # BAND_TRANSPORT from .env
    BAND_TRANSPORT=laptop-mic uv run python scripts/run_person_a.py     # Nova smoke test on the laptop mic
    BAND_TRANSPORT=sim SIM_WAV=fixtures/convo1.wav uv run python scripts/run_person_a.py
    uv run python scripts/run_person_a.py --no-stt              # band + motion + taps only, no Deepgram

Taps: double-tap the band, or type d + Enter (double) / s + Enter (single) with sim or laptop-mic.
Add --autostart to start a session right away.
"""
import argparse
import asyncio
import json
import logging
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def load_env():
    p = ROOT / ".env"
    if p.exists():
        for line in p.read_text().splitlines():
            line = line.split("#", 1)[0].strip()
            if "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


async def main(a):
    from backend.session import SessionController
    quiet = {"motion"} if not a.motion else set()

    def emit(ev):
        if ev["type"] in quiet:
            return
        print(json.dumps(ev), flush=True)

    ctl = SessionController(emit, use_pipecat=not a.no_stt)
    await ctl.start()
    if a.autostart:
        await ctl.start_session()
    try:
        while True:
            await asyncio.sleep(3600)
    finally:
        await ctl.shutdown()


if __name__ == "__main__":
    load_env()
    p = argparse.ArgumentParser()
    p.add_argument("--no-stt", action="store_true")
    p.add_argument("--autostart", action="store_true")
    p.add_argument("--motion", action="store_true", help="also print motion events (2 per second)")
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s", stream=sys.stderr)
    try:
        asyncio.run(main(p.parse_args()))
    except KeyboardInterrupt:
        pass
