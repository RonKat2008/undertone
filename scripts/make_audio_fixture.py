"""Turn a scripted conversation into real two-speaker audio for the speech pipeline.

    set -a; source /path/to/.env; set +a        # DEEPGRAM_API_KEY, never printed
    uv run python scripts/make_audio_fixture.py
    uv run python scripts/make_audio_fixture.py --script fixtures/demo_session.jsonl --other-db -10

Reads the turn.final events of a session fixture, speaks each line with Deepgram Aura-2
(a different voice per speaker), trims the TTS silence, and lays the lines out on one
16 kHz mono 16-bit timeline that keeps the script's gaps between turns (negative gaps, i.e.
interruptions, become real overlap). Writes:

    fixtures/audio/<name>.wav             the conversation
    fixtures/audio/<name>.truth.json      speaker, text, start, end, words, wpm, fillers per turn

The wearer ("me") is mixed louder than the other person (`--other-db`, default -10 dB), as
a wrist microphone hears its wearer from ~25 cm and the other person from ~1 m. TTS per
line is cached in fixtures/audio/tts_cache/ (git-ignored), so re-runs cost nothing.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import sys
import wave
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.stt.fillers import DEFAULT_FILLERS, find_fillers  # noqa: E402

SR = 16000
VOICES = {"me": "aura-2-thalia-en", "other": "aura-2-orion-en"}  # female wearer, male other
TTS_URL = "https://api.deepgram.com/v1/speak?model={model}&encoding=linear16&sample_rate=16000&container=wav"
WEARER_RMS_DB = -20.0  # speech level of the wearer at the wrist (dBFS, active speech only)


def load_turns(path: Path) -> list[dict]:
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        d = json.loads(line)
        ev = d.get("event", d)
        if ev.get("type") == "turn.final":
            out.append({"speaker": ev["speaker"], "text": ev["text"], "start": float(ev["start"]),
                        "end": float(ev["end"])})
    out.sort(key=lambda t: t["start"])
    if not out:
        raise SystemExit("no turn.final events in %s" % path)
    return out


def tts_text(text: str) -> str:
    """What the TTS voice is asked to say: the script line, with a cut-off dash made a comma."""
    return text.replace("—", ",").strip()


def tts(text: str, voice: str, cache: Path) -> np.ndarray:
    cache.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(("%s|%s" % (voice, text)).encode()).hexdigest()[:16]
    f = cache / ("%s_%s.wav" % (voice, key))
    if not f.exists():
        import httpx
        api_key = os.environ.get("DEEPGRAM_API_KEY")
        if not api_key:
            raise SystemExit("DEEPGRAM_API_KEY is not set (source the .env first)")
        r = httpx.post(TTS_URL.format(model=voice), headers={"Authorization": "Token " + api_key},
                       json={"text": text}, timeout=60)
        if r.status_code != 200:
            raise SystemExit("Deepgram TTS failed: HTTP %d" % r.status_code)
        f.write_bytes(r.content)
        print("tts  %-18s %3d chars -> %s" % (voice, len(text), f.name))
    return read_wav(f)


def read_wav(path: Path) -> np.ndarray:
    with wave.open(str(path), "rb") as w:
        if (w.getframerate(), w.getnchannels(), w.getsampwidth()) != (SR, 1, 2):
            raise SystemExit("%s is not 16 kHz mono 16-bit" % path)
        return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32768.0


def write_wav(path: Path, x: np.ndarray) -> None:
    pcm = (np.clip(x, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm)
    path.write_bytes(buf.getvalue())


def frame_db(x: np.ndarray, frame: int = 160) -> np.ndarray:
    n = len(x) // frame
    f = x[: n * frame].reshape(n, frame)
    return 10 * np.log10(np.mean(f * f, axis=1) + 1e-12)


def trim(x: np.ndarray, below_peak_db: float = 40.0) -> np.ndarray:
    """Cut the TTS lead-in and tail: keep from the first to the last 10 ms frame within
    `below_peak_db` of the loudest frame."""
    db = frame_db(x)
    loud = np.where(db > db.max() - below_peak_db)[0]
    if loud.size == 0:
        return x
    return x[loud[0] * 160:(loud[-1] + 1) * 160]


def active_rms_db(x: np.ndarray) -> float:
    """Speech level over the frames that carry speech (within 30 dB of the peak)."""
    db = frame_db(x)
    act = db[db > db.max() - 30]
    return float(10 * np.log10(np.mean(10 ** (act / 10))))


def build(turns: list[dict], cache: Path, other_db: float) -> tuple[np.ndarray, list[dict]]:
    clips = []
    for t in turns:
        x = trim(tts(tts_text(t["text"]), VOICES[t["speaker"]], cache))
        target = WEARER_RMS_DB + (0.0 if t["speaker"] == "me" else other_db)
        x = x * 10 ** ((target - active_rms_db(x)) / 20)
        clips.append(x)
    # lay out: first turn at the script's own start, then keep each script gap
    starts = [turns[0]["start"]]
    for i in range(1, len(turns)):
        gap = turns[i]["start"] - turns[i - 1]["end"]
        starts.append(starts[i - 1] + len(clips[i - 1]) / SR + gap)
    total = max(s + len(c) / SR for s, c in zip(starts, clips)) + 1.0
    mix = np.zeros(int(total * SR) + 1, dtype=np.float32)
    truth = []
    for i, (t, s, c) in enumerate(zip(turns, starts, clips)):
        a = int(round(s * SR))
        mix[a:a + len(c)] += c
        dur = len(c) / SR
        words = t["text"].split()
        truth.append({"turn": i + 1, "speaker": t["speaker"], "voice": VOICES[t["speaker"]],
                      "text": t["text"], "start": round(s, 3), "end": round(s + dur, 3),
                      "words": len(words), "wpm": round(len(words) / dur * 60, 1),
                      "fillers": find_fillers(words, DEFAULT_FILLERS),
                      "level_db": round(WEARER_RMS_DB + (0.0 if t["speaker"] == "me" else other_db), 1)})
    peak = float(np.max(np.abs(mix)))
    if peak > 0.99:
        mix *= 0.99 / peak
    return mix, truth


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    p.add_argument("--script", default=str(ROOT / "fixtures" / "demo_session.jsonl"))
    p.add_argument("--out-dir", default=str(ROOT / "fixtures" / "audio"))
    p.add_argument("--name", default="demo_two_speakers")
    p.add_argument("--other-db", type=float, default=-10.0,
                   help="level of the other person relative to the wearer (dB)")
    a = p.parse_args()
    out = Path(a.out_dir)
    out.mkdir(parents=True, exist_ok=True)
    turns = load_turns(Path(a.script))
    mix, truth = build(turns, out / "tts_cache", a.other_db)
    wav = out / (a.name + ".wav")
    write_wav(wav, mix)
    meta = {"source_script": os.path.relpath(a.script, ROOT), "wav": wav.name, "sample_rate": SR,
            "duration_s": round(len(mix) / SR, 3), "wearer": "me", "voices": VOICES,
            "other_level_db": a.other_db, "filler_list": DEFAULT_FILLERS, "turns": truth}
    (out / (a.name + ".truth.json")).write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    overlaps = [(truth[i - 1]["turn"], truth[i]["turn"], round(truth[i - 1]["end"] - truth[i]["start"], 2))
                for i in range(1, len(truth)) if truth[i]["start"] < truth[i - 1]["end"]]
    print("wrote %s (%.1f s, %.1f MB) and %s.truth.json: %d turns, overlaps %s"
          % (wav.relative_to(ROOT), len(mix) / SR, wav.stat().st_size / 1e6, a.name, len(truth), overlaps or "none"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
