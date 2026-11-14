"""Live conversation metrics (plan.md 4.4).

FINAL PUBLIC INTERFACE (do not change signatures; add private modules inside backend/metrics/):

    class MetricsEngine:
        def __init__(self, baseline_wpm: float | None, baseline_volume_db: float | None,
                     filler_words: list[str]) -> None
        def add_turn(self, turn: TurnFinalEvent) -> None          # every turn, both speakers
        def add_partial(self, partial: TranscriptPartialEvent, now: float) -> None
        def add_motion(self, motion_event: MotionEvent) -> None
        def add_volume(self, db: float, ts: float) -> None        # wearer loudness samples
        def note_judge(self, judge_event: JudgeEvent) -> None     # counts judged interruptions/questions
        def snapshot(self, now: float) -> Metrics                 # now = seconds since session start
        def timeline(self) -> list[TimelinePoint]                 # every 5 s, for the debrief

ADDITIONS (for brain.py / fusion / debrief):
        def fillers_for(self, text: str) -> list[str]             # per-turn list for turn.final.fillers
        def fidget_while_other_s(self, now: float) -> float       # current streak
        def fidget_while_other_total_s(self) -> float             # whole session
        def nerves(self, now: float) -> bool
        def checked_out(self, now: float) -> bool
        def detect_signals(self, now: float) -> list[SignalEvent] # new signals, cooldown applied
        peak_monologue_s: float                                   # longest monologue seen in snapshots
    find_fillers(text, filler_words) -> list[str]                 # module-level helper

Private modules: text (fillers, words), speech (talk ratio, pace, fillers/min), runs (monologue),
judge_tally, volume, hands, signals, timeline.
"""

from __future__ import annotations

import logging
import math

from backend.contracts import (
    JudgeEvent, Metrics, MotionEvent, SignalEvent, TimelinePoint, TranscriptPartialEvent,
    TurnFinalEvent, VolumeState,
)
from backend.metrics import hands, signals, speech, volume
from backend.metrics.judge_tally import JudgeTally
from backend.metrics.runs import RunTracker
from backend.metrics.text import find_fillers
from backend.metrics.timeline import TIMELINE_STEP_S, build_timeline

__all__ = ["MetricsEngine", "find_fillers", "TIMELINE_STEP_S"]

log = logging.getLogger("undertone.metrics")


def _finite(*values: float) -> bool:
    return all(isinstance(v, (int, float)) and math.isfinite(v) for v in values)


class MetricsEngine:
    def __init__(self, baseline_wpm: float | None, baseline_volume_db: float | None,
                 filler_words: list[str]) -> None:
        self.baseline_wpm = baseline_wpm
        self.baseline_volume_db = baseline_volume_db
        self.filler_words = [w.lower() for w in filler_words]
        self._turns: list[TurnFinalEvent] = []
        self._motion: list[MotionEvent] = []
        self._volume: list[tuple[float, float]] = []
        self._tally = JudgeTally()
        self._me_run = RunTracker("me")
        self._other_run = RunTracker("other")
        self._session_baseline_wpm: float | None = None
        self._volume_state: VolumeState = "ok"
        self._gate = signals.SignalGate()
        self._last = Metrics(baseline_wpm=baseline_wpm)
        self._latest_now = 0.0
        self.peak_monologue_s = 0.0

    # ---------- inputs ----------
    def add_turn(self, turn: TurnFinalEvent) -> None:
        if not _finite(turn.start, turn.end):
            return
        kept = [t for t in self._turns if t.turn_id != turn.turn_id]  # a re-sent turn replaces
        self._turns = [*kept, turn]
        self._me_run.on_turn(turn)
        self._other_run.on_turn(turn)

    def add_partial(self, partial: TranscriptPartialEvent, now: float) -> None:
        if partial.speaker is None or not _finite(now):
            return
        self._me_run.on_partial(partial.speaker, now)
        self._other_run.on_partial(partial.speaker, now)

    def add_motion(self, motion_event: MotionEvent) -> None:
        if _finite(motion_event.ts, motion_event.hand_energy):
            self._motion = [*self._motion, motion_event]

    def add_volume(self, db: float, ts: float) -> None:
        if _finite(db, ts):
            self._volume = [*self._volume, (float(ts), float(db))]

    def note_judge(self, judge_event: JudgeEvent) -> None:
        self._tally.note(judge_event)

    # ---------- helpers ----------
    def fillers_for(self, text: str) -> list[str]:
        return find_fillers(text, self.filler_words)

    def _effective_baseline_wpm(self) -> float | None:
        if self.baseline_wpm is not None:
            return self.baseline_wpm
        if self._session_baseline_wpm is None:
            self._session_baseline_wpm = speech.baseline_from_first(self._turns)
        return self._session_baseline_wpm

    def _volume_baseline(self) -> float | None:
        if self.baseline_volume_db is not None:
            return self.baseline_volume_db
        return volume.session_baseline_db(self._volume)

    def _default_db(self) -> float:
        return self.baseline_volume_db if self.baseline_volume_db is not None else volume.SILENT_DB

    # ---------- outputs ----------
    def snapshot(self, now: float) -> Metrics:
        try:
            if not _finite(now):
                return self._last
            self._latest_now = max(self._latest_now, now)
            snap = self._compute(now)
        except Exception:
            log.exception("metrics snapshot failed at %s; returning last good snapshot", now)
            return self._last
        self._last = snap
        self.peak_monologue_s = max(self.peak_monologue_s, snap.monologue_s)
        return snap

    def _compute(self, now: float) -> Metrics:
        db = volume.rolling_db(self._volume, now)
        self._volume_state = volume.next_volume_state(self._volume_state, db, self._volume_baseline())
        return Metrics(
            talk_ratio=speech.talk_ratio(self._turns, until=now),
            interruptions=self._tally.interruptions,
            questions=self._tally.questions,
            fillers_per_min=speech.fillers_per_min(self._turns, self.filler_words, now),
            wpm=speech.rolling_wpm(self._turns, now),
            baseline_wpm=self._effective_baseline_wpm(),
            monologue_s=self._me_run.value(now),
            volume_db=db if db is not None else self._default_db(),
            volume_state=self._volume_state,
            hand_energy=hands.smoothed_energy(self._motion, now),
        )

    def timeline(self) -> list[TimelinePoint]:
        try:
            return build_timeline(self._turns, self._motion, self._volume, self._latest_now,
                                  self._default_db())
        except Exception:
            log.exception("metrics timeline failed")
            return []

    # ---------- fusion ----------
    def fidget_while_other_s(self, now: float) -> float:
        return hands.fidget_while_other_s(self._motion, now)

    def fidget_while_other_total_s(self) -> float:
        return hands.fidget_while_other_total_s(self._motion)

    def nerves(self, now: float) -> bool:
        return signals.nerves(self._turns, self._motion, self._effective_baseline_wpm(), now)

    def checked_out(self, now: float) -> bool:
        return signals.checked_out(self._other_run.value(now), self._other_run.run_start,
                                   self._motion, now)

    def detect_signals(self, now: float) -> list[SignalEvent]:
        """New nerves / checked_out signals at `now`, each at most once per 30 s. Never raises."""
        try:
            found: list[SignalEvent] = []
            if self.nerves(now) and self._gate.admit("nerves", now):
                pace = speech.window_wpm(self._turns, now - signals.NERVES_WINDOW_S, now)
                detail = signals.describe("nerves", pace, self._effective_baseline_wpm(), 0.0)
                found.append(signals.make_signal("nerves", detail, now))
            if self.checked_out(now) and self._gate.admit("checked_out", now):
                detail = signals.describe("checked_out", None, None, self._other_run.value(now))
                found.append(signals.make_signal("checked_out", detail, now))
            return found
        except Exception:
            log.exception("signal detection failed at %s", now)
            return []
