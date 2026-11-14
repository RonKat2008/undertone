"""Real audio through the real speech pipeline, scored against ground truth.

    uv run --env-file /path/to/.env python scripts/eval_audio.py                 # clean
    uv run --env-file /path/to/.env python scripts/eval_audio.py --snr 15        # + background noise
    uv run --env-file /path/to/.env python scripts/eval_audio.py --opus          # through the band's codec

The WAV (scripts/make_audio_fixture.py) is played by the `file` band transport: 20 ms
frames in real time into BandSource._push_pcm, exactly where decoded band packets go, then
SessionController -> Hearing (Pipecat + Deepgram Nova-3, diarize) -> SpeakerMapper ->
turn assembly -> turn.final. Every turn.final is stamped with the session audio clock
when it arrives, for latency. One run streams ~95 s of audio to Deepgram.

Prints a scorecard (backend/stt/audio_eval.py) and writes the raw events + card as JSON
(--json). Always exits 0. Never prints keys.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

AUDIO = ROOT / "fixtures" / "audio"
SR = 16000


def add_noise(src: Path, truth: list, snr_db: float, out: Path, seed: int = 7) -> float:
    """Room-like noise (pink noise + a little 100 Hz hum) at `snr_db` below the speech level,
    where speech level = mean power inside the truth turns. Returns the realised SNR."""
    with wave.open(str(src), "rb") as w:
        x = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float64) / 32768.0
    rng = np.random.default_rng(seed)
    spec = np.fft.rfft(rng.standard_normal(len(x)))
    f = np.fft.rfftfreq(len(x), 1 / SR)
    spec[1:] /= np.sqrt(f[1:])  # 1/f power: pink
    spec[f < 40] = 0
    noise = np.fft.irfft(spec, len(x))
    noise += 0.15 * np.std(noise) * np.sin(2 * np.pi * 100 * np.arange(len(x)) / SR)
    mask = np.zeros(len(x), dtype=bool)
    for g in truth:
        mask[int(g["start"] * SR):int(g["end"] * SR)] = True
    p_speech = float(np.mean(x[mask] ** 2))
    noise *= np.sqrt(p_speech / 10 ** (snr_db / 10) / np.mean(noise ** 2))
    y = x + noise
    peak = np.max(np.abs(y))
    if peak > 0.99:
        y *= 0.99 / peak
    with wave.open(str(out), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((np.clip(y, -1, 1) * 32767).astype("<i2").tobytes())
    return 10 * np.log10(p_speech / np.mean(noise ** 2))


class LogCounter(logging.Handler):
    def __init__(self):
        super().__init__(logging.WARNING)
        self.lines = []

    def emit(self, record):
        self.lines.append("%s %s: %s" % (record.levelname, record.name, record.getMessage()[:200]))


async def run(wav: Path, opus: bool, flux: bool, tail_s: float) -> dict:
    os.environ["STT"] = "deepgram"
    os.environ["USE_FLUX"] = "true" if flux else "false"
    from backend.band.source import BandSource
    from backend.session import SessionController

    events = []
    words = []
    final_lag = []  # audio seconds from a final's last word to its arrival
    band = BandSource("file", 0, keyboard=False, audio_file=str(wav), file_opus=opus)

    def emit(ev):
        if ev.get("type") in ("turn.final", "transcript.partial", "calibration"):
            events.append(dict(ev, emitted_at=round(band.audio_seconds, 3), wall=round(time.monotonic() - t0, 3)))

    t0 = time.monotonic()
    ctl = SessionController(emit, band=band, use_pipecat=True)
    orig = ctl._on_words

    def on_words(speaker, ws):
        words.extend((speaker, w) for w in ws)
        final_lag.append(round(band.audio_seconds - max(w.end for w in ws), 2))
        orig(speaker, ws)

    ctl._on_words = on_words  # Hearing takes it at start_session
    await ctl.start()
    await ctl.start_session()
    started = ctl.hearing is not None
    if started:
        await band.file_done.wait()
        await asyncio.sleep(tail_s)  # the band keeps streaming (silence) after the last word
    await ctl.stop_session()
    await ctl.shutdown()
    await asyncio.sleep(2.0)  # let Pipecat's own tasks wind down before the loop closes
    return {"events": events, "words": words, "final_lag": final_lag, "hearing_started": started,
            "dropped_chunks": band.dropped_chunks, "audio_s": band.audio_seconds,
            "swapped_by_loudness": ctl.mapper.swapped_by_loudness}


def run_to_end(coro):
    """asyncio.run, but a straggler task that ignores cancellation cannot hang the exit."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        left = [t for t in asyncio.all_tasks(loop) if not t.done()]
        for t in left:
            t.cancel()
        if left:
            loop.run_until_complete(asyncio.wait(left, timeout=3))


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--name", default="demo_two_speakers")
    p.add_argument("--snr", type=float, default=None, help="mix in background noise at this SNR (dB)")
    p.add_argument("--opus", action="store_true", help="run every 20 ms frame through the band's Opus codec")
    p.add_argument("--flux", action="store_true", help="USE_FLUX=true (Flux turn boundaries + Nova words)")
    p.add_argument("--model", default=None, help="STT_MODEL for the word stream (default nova-2)")
    p.add_argument("--tail", type=float, default=4.0, help="seconds of silence after the file")
    p.add_argument("--json", default=None, help="write events + scorecard here")
    p.add_argument("--rescore", default=None, help="score a saved --json run again, no network")
    a = p.parse_args()
    try:
        from backend.stt.audio_eval import format_card, score
        from backend.stt.turns import Word
        meta = json.loads((AUDIO / (a.name + ".truth.json")).read_text())
        truth = meta["turns"]
        if a.rescore:
            saved = json.loads(Path(a.rescore).read_text())
            out = saved["run"]
            out["words"] = [(s, Word(*w)) for s, w in out["words"]]
            title = saved["title"]
        else:
            if not os.environ.get("DEEPGRAM_API_KEY"):
                print("DEEPGRAM_API_KEY is not set: run with uv run --env-file <.env> ...")
                return 0
            wav = AUDIO / meta["wav"]
            title = "clean"
            if a.snr is not None:
                noisy = AUDIO / ("%s.snr%g.noisy.wav" % (a.name, a.snr))
                real = add_noise(wav, truth, a.snr, noisy)
                wav, title = noisy, "noise %.1f dB SNR (other speaker %.0f dB lower)" % (real, -meta["other_level_db"])
            if a.opus:
                title += ", band Opus codec"
            if a.flux:
                title += ", Flux"
            if a.model:
                os.environ["STT_MODEL"] = a.model
            from backend.stt.pipeline import stt_model
            title += ", " + stt_model()
            try:
                from loguru import logger as _lg
                _lg.remove()
                pipecat_lines = []
                _lg.add(lambda m: pipecat_lines.append(m.strip()[:240]), level="WARNING")
            except ImportError:
                pipecat_lines = []
            counter = LogCounter()
            logging.getLogger().addHandler(counter)
            logging.getLogger().setLevel(logging.INFO)
            out = run_to_end(run(wav, a.opus, a.flux, a.tail))
            out["warnings"] = counter.lines + pipecat_lines
        turns = [e for e in out["events"] if e["type"] == "turn.final"]
        card = score(truth, turns, out["words"])
        print(format_card(card, title))
        warn = out.get("warnings", [])
        recon = [w for w in warn if "reconnect" in w.lower() or "connection lost" in w.lower()]
        print("pipeline         hearing started %s, %d warnings/errors, %d reconnects, %d dropped chunks, "
              "loudness swap %s" % (out["hearing_started"], len(warn), len(recon), out["dropped_chunks"],
                                    out["swapped_by_loudness"]))
        lag = sorted(out.get("final_lag") or [])
        if lag:
            print("deepgram         final result arrives %.2fs (median) / %.2fs (worst) after its last word"
                  % (lag[len(lag) // 2], lag[-1]))
        for w in warn[:8]:
            print("   ", w)
        if a.json and not a.rescore:
            dump = dict(out, words=[(s, [w.text, w.start, w.end, w.label]) for s, w in out["words"]])
            Path(a.json).write_text(json.dumps({"title": title, "run": dump, "card": card}, indent=1))
            print("saved", a.json)
    except Exception as e:  # noqa: BLE001  (always exit 0; say what broke, never a key)
        print("eval failed: %s: %s" % (type(e).__name__, str(e)[:300]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
