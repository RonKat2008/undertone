"""Real end-to-end check of the spoken practice, without a human: synthetic answers (macOS `say`)
stream into WS /ws/practice in real time, like a microphone, and the script reports what came back.

    uv run python scripts/practice_e2e.py --url ws://localhost:8840/ws/practice

It "plays" the coach's audio by its duration (no speaker), sends playback_done when that would
have finished, waits a moment, answers, and repeats. All speech is synthetic.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import subprocess
import tempfile
import time
import wave
from pathlib import Path

import websockets

log = logging.getLogger("practice_e2e")

RATE_IN, RATE_OUT = 16000, 24000
CHUNK_S = 0.05
THINK_S = 1.2  # pause before answering
ANSWERS: list[tuple[int, str]] = [  # (speaking rate for `say`, synthetic answer)
    (235, "Um, so, basically, I, um, led a project where, like, we had to move the whole team to a new tool, "
          "and, uh, I showed them the data, um, that it saved two hours a week, and, you know, they agreed."),
    (175, "I would split profit into revenue and costs. Revenue is stores times customers times spend per visit. "
          "I would check which of those fell over the two years, and then compare costs per store."),
    (185, "I guess maybe around, I'm not totally sure, probably fifty thousand a year? It could be more. "
          "I think maybe I would start from the number of people in Paris."),
    (225, "Honestly I would, um, plan more up front. The first time we, uh, shipped two weeks late, and, "
          "you know, the client noticed. Next time I'd set a weekly check in."),
    (170, "One result I'm proud of is cutting our support backlog by forty percent in a month, "
          "by triaging every ticket each morning with the team."),
    (170, "I think that covers it. Thank you for the questions."),
]


def synth(text: str, rate: int, folder: Path, i: int) -> bytes:
    path = folder / f"answer{i}.wav"
    subprocess.run(["say", "-v", "Samantha", "-r", str(rate), "-o", str(path), "--file-format=WAVE",
                    "--data-format=LEI16@16000", text], check=True)
    with wave.open(str(path)) as w:
        return w.readframes(w.getnframes())


class Run:
    def __init__(self, ws, answers: list[bytes]) -> None:  # type: ignore[no-untyped-def]
        self.ws, self.answers = ws, answers
        self.t0 = time.monotonic()
        self.playing_until = 0.0
        self.coach_audio_s = 0.0
        self.need_done = False
        self.answer_ended_at: float | None = None
        self.latencies: list[float] = []
        self.captions: list[tuple[str, str]] = []
        self.final: dict | None = None
        self.ready = asyncio.Event()

    def now(self) -> float:
        return time.monotonic() - self.t0

    async def reader(self) -> None:
        async for msg in self.ws:
            if isinstance(msg, bytes):
                await self.on_audio(msg)
                continue
            data = json.loads(msg)
            kind = data["type"]
            if kind == "practice.caption":
                self.captions.append((data["role"], data["text"]))
                log.info("%6.1fs %s: %s", self.now(), data["role"], data["text"])
            elif kind == "practice.state":
                log.info("%6.1fs state %s", self.now(), data["state"])
                if data["state"] == "you":
                    self.playing_until, self.need_done = self.now(), False  # barge-in: stop "playback"
            else:
                log.info("%6.1fs %s", self.now(), kind if kind != "practice.result" else "practice.result")
            if kind == "practice.ready":
                self.ready.set()
            if kind in ("practice.result", "practice.no_result", "practice.error"):
                self.final = data
                if kind != "practice.error" or data.get("code") in ("no_key", "agent_refused", "busy"):
                    return

    async def on_audio(self, chunk: bytes) -> None:
        if self.answer_ended_at is not None:
            self.latencies.append(self.now() - self.answer_ended_at)
            self.answer_ended_at = None
        dur = len(chunk) / 2 / RATE_OUT
        self.coach_audio_s += dur
        self.playing_until = max(self.playing_until, self.now()) + dur
        self.need_done = True

    async def _paced(self, chunks: list[bytes]) -> None:
        """Send 50 ms chunks on a fixed schedule, like a real microphone (no drift)."""
        start = time.monotonic()
        for i, chunk in enumerate(chunks):
            if self.final is not None:
                return
            await self.ws.send(chunk)
            await asyncio.sleep(max(0.0, start + (i + 1) * CHUNK_S - time.monotonic()))

    async def send_silence(self, seconds: float) -> None:
        n = max(1, int(round(seconds / CHUNK_S)))
        await self._paced([b"\x00\x00" * int(RATE_IN * CHUNK_S)] * n)

    async def send_pcm(self, pcm: bytes) -> None:
        step = int(RATE_IN * CHUNK_S) * 2
        await self._paced([pcm[i:i + step] for i in range(0, len(pcm), step)])
        self.answer_ended_at = self.now()

    async def mic(self) -> None:
        await self.ready.wait()
        queue = list(self.answers)
        while self.final is None:
            if self.need_done and self.now() >= self.playing_until + 0.3:
                self.need_done = False
                await self.ws.send(json.dumps({"type": "playback_done"}))
                await self.send_silence(THINK_S)
                if queue and self.final is None:
                    await self.send_pcm(queue.pop(0))
            await self.send_silence(CHUNK_S)


async def main(url: str, max_s: float) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        answers = [synth(text, rate, Path(tmp), i) for i, (rate, text) in enumerate(ANSWERS)]
    async with websockets.connect(url, max_size=None) as ws:
        run = Run(ws, answers)
        mic = asyncio.create_task(run.mic())
        try:
            await asyncio.wait_for(run.reader(), max_s)
        except asyncio.TimeoutError:
            log.warning("no result after %.0f s: ending the practice", max_s)
            await ws.send(json.dumps({"type": "end"}))
            await asyncio.wait_for(run.reader(), 60)
        finally:
            mic.cancel()
    report(run)


def report(run: Run) -> None:
    lat = run.latencies
    log.info("coach turns: %d, coach audio %.1f s", sum(1 for r, _ in run.captions if r == "coach"), run.coach_audio_s)
    if lat:
        log.info("answer end -> first coach audio: min %.2f s, median %.2f s, max %.2f s",
                 min(lat), sorted(lat)[len(lat) // 2], max(lat))
    final = run.final or {}
    if final.get("type") == "practice.result":
        r = final["result"]
        log.info("overall %s, judged by %s, %d answers", r["overall"], r["judged_by"], len(r["answers"]))
        for s in r["sub_scores"]:
            log.info("  %-15s %3d  %-8s %s", s["label"], s["score"], s["source"], s["detail"])
        for g in r["goals"]:
            log.info("  goal: %s | %s | answer %s", g["title"], g["target"], g["from_answer"])
        for c in r["previous_goals"]:
            log.info("  last time: %s -> %s", c["goal"]["title"], c["detail"])
        for a in r["answers"]:
            log.info("  answer %d: %s words, %s wpm, fillers %s, start %s s, Q: %s", a["index"], a["words"], a["wpm"],
                     a["fillers"], a["time_to_start_s"], a["question"][:70])
    else:
        log.info("final: %s", final)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="ws://localhost:8840/ws/practice")
    parser.add_argument("--max-s", type=float, default=300.0)
    args = parser.parse_args()
    asyncio.run(main(args.url, args.max_s))
