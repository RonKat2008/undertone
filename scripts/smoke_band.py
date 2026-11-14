"""Phase 0 smoke test: connect to the band, print taps, motion and decoded audio level.

    uv run python scripts/smoke_band.py              # BAND_TRANSPORT from .env (ble | serial | sim)
    uv run python scripts/smoke_band.py --seconds 20 --transport ble

Double-tap the band first (blinks blue, discoverable for 60 s). Close the kit's browser dashboard.
"""
import argparse
import asyncio
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backend.band.audio import rms_db  # noqa: E402
from backend.band.source import BandSource  # noqa: E402


async def main(a):
    src = BandSource(a.transport, a.band, emit=lambda e: print("STATUS", e), keyboard=False)
    t0 = time.time()
    await src.start()
    print("connected in %.1fs" % (time.time() - t0))
    await src.mic(True)
    end = time.time() + a.seconds
    n_motion = n_chunks = 0
    last_print = 0.0
    while time.time() < end:
        await asyncio.sleep(0.05)
        while not src.tap_q.empty():
            print("TAP", src.tap_q.get_nowait())
        while not src.motion_q.empty():
            m = src.motion_q.get_nowait()
            n_motion += 1
        while not src.pcm_q.empty():
            c = src.pcm_q.get_nowait()
            n_chunks += 1
            db = rms_db(c)
        if time.time() - last_print > 1:
            last_print = time.time()
            lvl = locals().get("db")
            print("motion %4d samples | audio %3d chunks (80 ms) | level %s dBFS | dropped %d"
                  % (n_motion, n_chunks, "%.1f" % lvl if lvl is not None else "-", src.dropped_chunks))
    await src.stop()
    print("OK" if n_motion and n_chunks else "CHECK: no motion or no audio arrived")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--transport", default=os.getenv("BAND_TRANSPORT", "sim"))
    p.add_argument("--band", type=int, default=int(os.getenv("VEXO_BAND_NUMBER") or 13))
    p.add_argument("--seconds", type=float, default=15)
    asyncio.run(main(p.parse_args()))
