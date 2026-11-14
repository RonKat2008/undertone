"""Scripted speech: a stand-in for Deepgram that plays a conversation through the real path.

    STT=fake                              (default script: fixtures/sample_conversation.jsonl)
    STT_FAKE_SCRIPT=path/to/file.jsonl    any file with turn.final events, e.g. a recorded session
    STT_FAKE_SPEED=2                      play twice as fast

It builds Deepgram-shaped live results (words with start, end, speaker, punctuated_word) from
the script's turns and feeds them to Hearing._on_nova on the session clock, plus interim
results for the caption line. Everything after that is the real code: dedupe, speaker
mapping, turn assembly, pace, fillers, the bus, the Brain, nudges, haptics and the debrief.

Use it for UI work, demo rehearsal, and as the demo fallback if Deepgram is down.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from pathlib import Path
from typing import List, Optional, Tuple

from .pipeline import Hearing

log = logging.getLogger("undertone.stt.fake")
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SCRIPT = ROOT / "fixtures" / "sample_conversation.jsonl"
RESULT_S = 1.2  # Deepgram finalises roughly every second or so


def load_turns(path: Path) -> List[Tuple[str, float, float, str]]:
    """(speaker, start, end, text) for every turn.final in a jsonl file (with or without {"at", "event"})."""
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        d = json.loads(line)
        ev = d.get("event", d)
        if ev.get("type") == "turn.final":
            out.append((ev["speaker"], float(ev["start"]), float(ev["end"]), ev["text"]))
    out.sort(key=lambda t: t[1])
    if not out:
        raise ValueError("no turn.final events in %s" % path)
    return out


def script_results(turns, wearer_label: int = 0) -> List[dict]:
    """Deepgram-shaped final results: words spread evenly over each turn, cut into ~1.2 s results."""
    words = []
    for speaker, start, end, text in turns:
        toks = text.split()
        if not toks:
            continue
        step = max(end - start, 0.3) / len(toks)
        label = wearer_label if speaker == "me" else 1 - wearer_label
        for i, tok in enumerate(toks):
            ws = start + i * step
            bare = "".join(c for c in tok.lower() if c.isalnum() or c == "'")
            words.append({"word": bare or tok, "punctuated_word": tok, "start": round(ws, 3),
                          "end": round(ws + step * 0.85, 3), "speaker": label})
    words.sort(key=lambda w: w["start"])
    results, cur, cur_start = [], [], None
    for w in words:
        if cur and (w["end"] - cur_start > RESULT_S or w["speaker"] != cur[-1]["speaker"]):
            results.append(_result(cur))
            cur = []
        if not cur:
            cur_start = w["start"]
        cur.append(w)
    if cur:
        results.append(_result(cur))
    return results


def _result(words: List[dict]) -> dict:
    return {"start": words[0]["start"], "duration": words[-1]["end"] - words[0]["start"], "is_final": True,
            "channel": {"alternatives": [{"transcript": " ".join(w["punctuated_word"] for w in words),
                                          "words": words}]}}


class FakeHearing(Hearing):
    """Same interface as Hearing (start, stop, pace, nova_turns); no network."""

    def __init__(self, *args, script: Optional[str] = None, speed: Optional[float] = None, **kwargs) -> None:
        kwargs["use_flux"] = False
        super().__init__(*args, **kwargs)
        self.script = Path(script or os.getenv("STT_FAKE_SCRIPT") or DEFAULT_SCRIPT)
        self.speed = float(speed or os.getenv("STT_FAKE_SPEED") or 1.0)
        self._play = None
        self._t0 = None
        self.audio_clock = self._clock  # scripted time, so turns close on schedule

    def _clock(self) -> float:
        return 0.0 if self._t0 is None else (time.monotonic() - self._t0) * self.speed

    async def start(self) -> None:
        results = script_results(load_turns(self.script))
        self._t0 = time.monotonic()
        self._play = asyncio.create_task(self._run(results))
        self._ticker = asyncio.create_task(self._tick())
        log.info("scripted speech: %s (%d results, %.1fx)", self.script.name, len(results), self.speed)

    async def _run(self, results: List[dict]) -> None:
        for r in results:
            end = r["start"] + r["duration"]
            # interim halfway through, then the final once its last word has been "spoken"
            await self._sleep_until(r["start"] + r["duration"] / 2)
            half = r["channel"]["alternatives"][0]["words"][: max(1, len(r["channel"]["alternatives"][0]["words"]) // 2)]
            self._on_interim({"start": r["start"], "channel": {"alternatives": [{"words": half}]}},
                             " ".join(w["punctuated_word"] for w in half))
            await self._sleep_until(end + 0.3)  # Deepgram's finals land a few hundred ms after speech
            self._on_nova(r, r["channel"]["alternatives"][0]["transcript"])
        log.info("scripted speech: script finished")

    async def _sleep_until(self, t: float) -> None:
        delay = (t - self._clock()) / self.speed
        if delay > 0:
            await asyncio.sleep(delay)

    async def stop(self) -> None:
        for task in (self._play, self._ticker):
            if task is not None:
                task.cancel()
        self.nova_turns.flush()
