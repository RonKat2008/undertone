"""Voice + body fusion signals (plan.md 4.2): nerves and checked_out.

Pure detectors plus a small cooldown gate so the 1 Hz loop emits each signal once per episode.
"""

from __future__ import annotations

from collections.abc import Sequence

from backend.contracts import MotionEvent, SignalEvent, TurnFinalEvent
from backend.metrics.hands import hands_frozen
from backend.metrics.speech import window_wpm

NERVES_WINDOW_S = 10.0
NERVES_PACE_RATIO = 1.25
CHECKED_OUT_MIN_S = 30.0
SIGNAL_COOLDOWN_S = 30.0


def nerves(turns: Sequence[TurnFinalEvent], motion: Sequence[MotionEvent],
           baseline_wpm: float | None, now: float) -> bool:
    """Hands frozen AND wearer pace > 25% above baseline within the same 10 s."""
    if baseline_wpm is None or baseline_wpm <= 0:
        return False
    lo = now - NERVES_WINDOW_S
    if not hands_frozen(motion, lo, now):
        return False
    pace = window_wpm(turns, lo, now)
    return pace is not None and pace > baseline_wpm * NERVES_PACE_RATIO


def checked_out(other_run_s: float, other_run_start: float | None,
                motion: Sequence[MotionEvent], now: float) -> bool:
    """Still hands and no wearer question during 30 s+ of the other person talking.

    The other person's run resets whenever the wearer speaks, so a run of 30 s+ already
    means the wearer asked nothing during it.
    """
    if other_run_start is None or other_run_s < CHECKED_OUT_MIN_S:
        return False
    return hands_frozen(motion, other_run_start, now)


class SignalGate:
    """Emits a signal kind at most once per SIGNAL_COOLDOWN_S."""

    def __init__(self) -> None:
        self._last: dict[str, float] = {}

    def admit(self, kind: str, now: float) -> bool:
        last = self._last.get(kind)
        if last is not None and 0.0 <= now - last < SIGNAL_COOLDOWN_S:
            return False
        self._last = {**self._last, kind: now}
        return True


def describe(kind: str, pace: float | None, baseline: float | None, other_run_s: float) -> str:
    if kind == "nerves":
        pace_txt = f"{pace:.0f} wpm" if pace is not None else "fast pace"
        base_txt = f" vs baseline {baseline:.0f}" if baseline is not None else ""
        return f"hands froze while pace jumped to {pace_txt}{base_txt}"
    return f"hands still and no question for {other_run_s:.0f}s while the other person talked"


def make_signal(kind: str, detail: str, now: float) -> SignalEvent:
    return SignalEvent(kind=kind, detail=detail, ts=round(now, 2))  # type: ignore[arg-type]
