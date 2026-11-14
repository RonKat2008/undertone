"""Practice mode's live crutch-word buzz (plan.md 4.5, demo step 3).

In a practice round (session mode "practice") the phone buzzes `filler` every time the
wearer says one of their own crutch words, within about a second, from Deepgram's interim
results. Each buzz is also a `nudge` on the bus, in the shape the dashboard's practice panel
counts ("You said “basically”"). One `success` buzz per round at most, once the round is
clearly cleaner than the last one ("5 → 2").

    watcher = CrutchWatcher(app_state)          # attach_band() does this
    ctl.on_live_words = watcher.on_words        # interim + final words from Hearing

Regular mode is untouched: this only acts while the Brain's session is in practice mode.
"""
from __future__ import annotations

import logging
import re
import time
from typing import Any, Callable, Iterable, List, Optional, Sequence, Tuple

from backend import haptics_port
from backend.contracts import HapticCommand

log = logging.getLogger("undertone.practice")

BUDGET_LEFT = 99          # "no cap within a round" (the dashboard shows nothing for it)
SAME_WORD_WITHIN_S = 0.4  # an interim revision of the same word moves by less than this
SUCCESS_AFTER_SHARE = 0.8  # success once the round is 80% as long as the last one ...
_TOKEN = re.compile(r"[a-z']+")


def _norm(text: str) -> str:
    return "".join(_TOKEN.findall(text.lower()))


class CrutchWatcher:
    def __init__(self, app_state: Any, clock: Callable[[], float] = time.monotonic) -> None:
        self.app = app_state
        self.clock = clock
        self.phrases: List[Tuple[str, ...]] = []
        self.active = False
        self.count = 0
        self.previous: Optional[int] = None
        self.previous_duration: Optional[float] = None
        self._seen: List[Tuple[str, float]] = []   # (phrase, start) already buzzed
        self._recent: List[Any] = []               # last words, for multi-word crutches
        self._started_at: Optional[float] = None
        self._success_sent = False
        self._session_id: Optional[str] = None

    # ---------- round lifecycle (bus handlers) ----------

    async def on_started(self, ev: Any) -> None:
        session = getattr(self.app, "session", None)
        if getattr(ev, "mode", None) != "practice":
            self.active = False
            return
        coach = getattr(session, "coach", None)
        words = list(getattr(coach, "filler_words", None) or [])
        self.phrases = sorted({tuple(_norm(t) for t in w.split() if _norm(t)) for w in words} - {()},
                              key=len, reverse=True)
        self.active = bool(self.phrases)
        self.count, self._seen, self._recent = 0, [], []
        self._started_at, self._success_sent, self._session_id = self.clock(), False, ev.session_id
        log.info("practice round: watching %d crutch words", len(self.phrases))

    async def on_ended(self, ev: Any) -> None:
        if not self.active:
            return
        self.active = False
        self.previous = self.count
        self.previous_duration = self.clock() - (self._started_at or self.clock())
        log.info("practice round over: %d crutch words", self.count)

    # ---------- words (from Hearing, via SessionController.on_live_words) ----------

    def on_words(self, speaker: str, words: Sequence[Any], now: Optional[float] = None) -> None:
        if not self.active or speaker != "me" or not words:
            return
        self._recent = sorted({(round(w.start, 2), w.text): w for w in [*self._recent, *words]}.values(),
                              key=lambda w: w.start)[-12:]
        toks = [(_norm(w.text), w) for w in self._recent]
        toks = [(t, w) for t, w in toks if t]
        i = 0
        while i < len(toks):
            for p in self.phrases:
                if tuple(t for t, _ in toks[i:i + len(p)]) == p:
                    first, last = toks[i][1], toks[i + len(p) - 1][1]
                    self._hit(" ".join(p), first.start, last.end, now)
                    i += len(p)
                    break
            else:
                i += 1

    def _hit(self, phrase: str, start: float, end: float, now: Optional[float]) -> None:
        if any(p == phrase and abs(s - start) < SAME_WORD_WITHIN_S for p, s in self._seen):
            return
        self._seen.append((phrase, start))
        self.count += 1
        latency = max(0.0, (now - end)) * 1000 if now is not None else None
        self._buzz("filler", "Pause", "crutch", 'You said “%s”' % phrase, end, latency)
        log.info("practice: crutch '%s' at %.1fs (#%d)", phrase, end, self.count)

    def check_success(self, now_ts: float) -> None:
        """Once per round: fewer crutch words than last round, and most of last round's time used."""
        if (not self.active or self._success_sent or self.previous is None or self.previous_duration is None
                or self.count >= self.previous):
            return
        if self.clock() - (self._started_at or self.clock()) < SUCCESS_AFTER_SHARE * self.previous_duration:
            return
        self._success_sent = True
        self._buzz("success", "Cleaner round", "round_improved",
                   "%d crutch words last round, %d so far" % (self.previous, self.count), now_ts, None)

    async def on_turn(self, ev: Any) -> None:
        if getattr(ev, "speaker", None) == "me":
            self.check_success(float(getattr(ev, "end", 0.0)))

    # ---------- output ----------

    def _buzz(self, haptic: str, message: str, rule_id: str, reason: str, ts: float, latency_ms: Optional[float]) -> None:
        import asyncio

        nudge = {"type": "nudge", "rule_id": rule_id, "haptic": haptic, "message": message, "reason": reason,
                 "confidence": None, "latency_ms": round(latency_ms or 0.0), "budget_left": BUDGET_LEFT,
                 "ts": round(max(0.0, ts), 2)}

        async def send() -> None:
            await self.app.bus.publish(nudge)
            await haptics_port.send(HapticCommand(pattern=haptic, label=message))

        try:
            asyncio.get_running_loop().create_task(send())
        except RuntimeError:
            log.warning("practice: no event loop, buzz dropped")


def attach_practice(ctl: Any, app_state: Any) -> CrutchWatcher:
    """Wire the watcher to the bus and to the band's live words."""
    w = CrutchWatcher(app_state)
    bus = app_state.bus
    bus.on("session.started", w.on_started)
    bus.on("session.ended", w.on_ended)
    bus.on("turn.final", w.on_turn)
    ctl.on_live_words = w.on_words
    return w
