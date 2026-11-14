"""Live conversation metrics (plan.md 4.4).

FINAL PUBLIC INTERFACE (do not change signatures; add private modules inside backend/metrics/):

    class MetricsEngine:
        def __init__(self, baseline_wpm: float | None, baseline_volume_db: float | None,
                     filler_words: list[str]) -> None
        def add_turn(self, turn: TurnFinalEvent) -> None          # every turn, both speakers
        def add_partial(self, partial: TranscriptPartialEvent, now: float) -> None
                                                                  # live words: lets monologue_s grow
                                                                  # before the turn.final arrives
        def add_motion(self, motion_event: MotionEvent) -> None
        def add_volume(self, db: float, ts: float) -> None        # wearer loudness samples
        def note_judge(self, judge_event: JudgeEvent) -> None     # e.g. count judged interruptions
        def snapshot(self, now: float) -> Metrics                 # now = seconds since session start
        def timeline(self) -> list[TimelinePoint]                 # every 5 s, for the debrief

STUB: simple but working numbers so the loop and dashboard have data. The worker refines
(rolling 15 s wpm from words, tolerance bands, volume_state vs baseline, hand energy smoothing).
"""

from __future__ import annotations

from backend.contracts import (
    JudgeEvent, Metrics, MotionEvent, TimelinePoint, TranscriptPartialEvent, TurnFinalEvent,
)

TIMELINE_STEP_S = 5.0
_INTERRUPT_OVERLAP_S = 0.2


class MetricsEngine:
    def __init__(self, baseline_wpm: float | None, baseline_volume_db: float | None,
                 filler_words: list[str]) -> None:
        self.baseline_wpm = baseline_wpm
        self.baseline_volume_db = baseline_volume_db
        self.filler_words = [w.lower() for w in filler_words]
        self._turns: list[TurnFinalEvent] = []
        self._motion: list[MotionEvent] = []
        self._volume: list[tuple[float, float]] = []
        self._interruptions = 0
        self._me_run_start: float | None = None  # start of the wearer's current run
        self._last_other_end: float = 0.0

    def add_turn(self, turn: TurnFinalEvent) -> None:
        prev = self._turns[-1] if self._turns else None
        if (turn.speaker == "me" and prev is not None and prev.speaker == "other"
                and prev.end - turn.start > _INTERRUPT_OVERLAP_S):
            self._interruptions += 1
        if turn.speaker == "me":
            if self._me_run_start is None or (prev is not None and prev.speaker == "other"):
                self._me_run_start = turn.start
        else:
            self._me_run_start = None
            self._last_other_end = turn.end
        self._turns = [*self._turns, turn]

    def add_partial(self, partial: TranscriptPartialEvent, now: float) -> None:
        if partial.speaker == "me" and self._me_run_start is None:
            self._me_run_start = max(self._last_other_end, now - 1.0)
        elif partial.speaker == "other":
            self._me_run_start = None

    def add_motion(self, motion_event: MotionEvent) -> None:
        self._motion = [*self._motion, motion_event]

    def add_volume(self, db: float, ts: float) -> None:
        self._volume = [*self._volume, (ts, db)]

    def note_judge(self, judge_event: JudgeEvent) -> None:
        return None

    def _me(self) -> list[TurnFinalEvent]:
        return [t for t in self._turns if t.speaker == "me"]

    def snapshot(self, now: float) -> Metrics:
        me = self._me()
        me_time = sum(max(0.0, t.end - t.start) for t in me)
        all_time = sum(max(0.0, t.end - t.start) for t in self._turns)
        fillers = sum(len(t.fillers) for t in me)
        recent = [t for t in me if t.end >= now - 15] or me[-1:]
        wpm = sum(t.wpm for t in recent) / len(recent) if recent else 0.0
        vol = self._volume[-1][1] if self._volume else (self.baseline_volume_db or 0.0)
        hand = self._motion[-1].hand_energy if self._motion else 0.0
        return Metrics(
            talk_ratio=round(me_time / all_time, 3) if all_time else 0.0,
            interruptions=self._interruptions,
            questions=sum(t.text.count("?") for t in me),
            fillers_per_min=round(fillers / (me_time / 60), 2) if me_time > 0 else 0.0,
            wpm=round(wpm, 1),
            baseline_wpm=self.baseline_wpm,
            monologue_s=round(max(0.0, now - self._me_run_start), 1) if self._me_run_start is not None else 0.0,
            volume_db=round(vol, 1),
            volume_state="ok",
            hand_energy=round(hand, 3),
        )

    def timeline(self) -> list[TimelinePoint]:
        end = max([t.end for t in self._turns] + [m.ts for m in self._motion] + [0.0])
        points: list[TimelinePoint] = []
        t = 0.0
        while t <= end:
            win_turns = [x for x in self._me() if x.start <= t + TIMELINE_STEP_S and x.end >= t]
            win_motion = [m for m in self._motion if t <= m.ts < t + TIMELINE_STEP_S]
            win_vol = [d for ts, d in self._volume if t <= ts < t + TIMELINE_STEP_S]
            points.append(TimelinePoint(
                t=t,
                wpm=round(sum(x.wpm for x in win_turns) / len(win_turns), 1) if win_turns else 0.0,
                volume_db=round(sum(win_vol) / len(win_vol), 1) if win_vol else 0.0,
                hand_energy=round(sum(m.hand_energy for m in win_motion) / len(win_motion), 3) if win_motion else 0.0,
            ))
            t += TIMELINE_STEP_S
        return points
