"""RunTracker: how long one speaker has talked without the other speaker speaking.

Used for the wearer's live monologue timer and the other person's stretch. Times are seconds
since session start. A turn.final arrives at its end; partials carry no timestamp, so the
caller passes `now` when one arrives.
"""

from __future__ import annotations

from typing import Literal

from backend.contracts import TurnFinalEvent

PARTIAL_FRESH_S = 2.0  # partials newer than this keep the timer growing by wall clock
PARTIAL_LEAD_S = 1.0  # a run opened by a partial is assumed to have started this much earlier


class RunTracker:
    """Stateful tracker for the current uninterrupted run of `speaker`."""

    def __init__(self, speaker: Literal["me", "other"]) -> None:
        self._speaker: str = speaker
        self._run_start: float | None = None
        self._last_opposite_end: float = 0.0
        self._last_activity: float = 0.0
        self._last_partial_at: float | None = None

    @property
    def run_start(self) -> float | None:
        return self._run_start

    def _close(self) -> None:
        self._run_start = None
        self._last_partial_at = None

    def on_turn(self, turn: TurnFinalEvent) -> None:
        if turn.speaker != self._speaker:
            if self._run_start is not None and turn.end > self._run_start:
                self._close()
            self._last_opposite_end = max(self._last_opposite_end, turn.end)
            return
        if turn.end <= self._last_opposite_end:
            return  # stale: the opposite speaker has spoken since
        candidate = max(turn.start, self._last_opposite_end)
        self._run_start = candidate if self._run_start is None else min(self._run_start, candidate)
        self._last_activity = max(self._last_activity, turn.end)
        if self._last_partial_at is not None and turn.end >= self._last_partial_at - PARTIAL_FRESH_S:
            self._last_partial_at = None  # the streamed turn is final: stop growing by wall clock

    def on_partial(self, speaker: str | None, now: float) -> None:
        if speaker is None:
            return
        if speaker != self._speaker:
            self._close()
            self._last_opposite_end = max(self._last_opposite_end, now)
            return
        if self._run_start is None:
            self._run_start = max(self._last_opposite_end, now - PARTIAL_LEAD_S)
        self._last_partial_at = now
        self._last_activity = max(self._last_activity, now)

    def value(self, now: float) -> float:
        if self._run_start is None:
            return 0.0
        end = self._last_activity
        if self._last_partial_at is not None and 0.0 <= now - self._last_partial_at < PARTIAL_FRESH_S:
            end = max(end, now)
        return round(max(0.0, end - self._run_start), 1)
