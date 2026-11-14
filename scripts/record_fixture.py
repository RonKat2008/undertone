"""Record a fixture from the band: decoded audio (wav), motion (csv) and taps (csv).

    uv run python scripts/record_fixture.py --seconds 120 --name convo1
    -> fixtures/convo1.wav (git-ignored), fixtures/convo1.motion.csv, fixtures/convo1.taps.csv

Play it back later without the band:  BAND_TRANSPORT=sim SIM_WAV=fixtures/convo1.wav
"""
import argparse
import asyncio
import csv
import os
import sys
import time
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.band.source import BandSource  # noqa: E402


async def main(a):
    out = ROOT / "fixtures"
    out.mkdir(exist_ok=True)
    src = BandSource(a.transport, a.band, keyboard=False)
    await src.start()
    src.reset_clock()
    await src.mic(True)
    wav = wave.open(str(out / (a.name + ".wav")), "wb")
    wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
    mf = open(out / (a.name + ".motion.csv"), "w", newline="")
    tf = open(out / (a.name + ".taps.csv"), "w", newline="")
    mw, tw = csv.writer(mf), csv.writer(tf)
    mw.writerow(["t", "ax", "ay", "az", "gx", "gy", "gz"]); tw.writerow(["t", "kind"])
    print("recording %ds... talk, gesture, fidget, tap" % a.seconds)
    end = time.time() + a.seconds
    while time.time() < end:
        await asyncio.sleep(0.05)
        while not src.pcm_q.empty():
            wav.writeframes(src.pcm_q.get_nowait())
        while not src.motion_q.empty():
            m = src.motion_q.get_nowait()
            mw.writerow(["%.3f" % m.t] + ["%.4f" % v for v in (m.ax, m.ay, m.az, m.gx, m.gy, m.gz)])
        while not src.tap_q.empty():
            tw.writerow(["%.2f" % src.now(), src.tap_q.get_nowait()])
    await src.stop()
    wav.close(); mf.close(); tf.close()
    print("saved fixtures/%s.{wav,motion.csv,taps.csv}" % a.name)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--transport", default=os.getenv("BAND_TRANSPORT", "ble"))
    p.add_argument("--band", type=int, default=int(os.getenv("VEXO_BAND_NUMBER") or 13))
    p.add_argument("--seconds", type=float, default=120)
    p.add_argument("--name", default="convo1")
    asyncio.run(main(p.parse_args()))
