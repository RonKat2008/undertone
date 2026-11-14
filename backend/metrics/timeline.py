"""Voice and body timeline for the debrief: one point every 5 s (plan.md 4.6)."""

from __future__ import annotations

from collections.abc import Sequence

from backend.contracts import MotionEvent, TimelinePoint, TurnFinalEvent
from backend.metrics.hands import smoothed_series
from backend.metrics.speech import rolling_wpm
from backend.metrics.volume import rolling_db

TIMELINE_STEP_S = 5.0
MAX_POINTS = 2880  # 4 h of session; guards against a garbage timestamp


def session_end(turns: Sequence[TurnFinalEvent], motion: Sequence[MotionEvent],
                samples: Sequence[tuple[float, float]], latest_now: float) -> float:
    ends = [t.end for t in turns] + [m.ts for m in motion] + [ts for ts, _ in samples] + [latest_now]
    return max(0.0, *ends)


def build_timeline(turns: Sequence[TurnFinalEvent], motion: Sequence[MotionEvent],
                   samples: Sequence[tuple[float, float]], latest_now: float,
                   default_db: float) -> list[TimelinePoint]:
    """wpm is the rolling pace (0 before the wearer speaks, carried through silences), volume the
    rolling voiced loudness over the last 5 s (held through pauses), hand energy smoothed."""
    end = session_end(turns, motion, samples, latest_now)
    count = min(int(end // TIMELINE_STEP_S) + 1, MAX_POINTS)
    times = [i * TIMELINE_STEP_S for i in range(count)]
    energies = smoothed_series(motion, times)
    points: list[TimelinePoint] = []
    for t, energy in zip(times, energies, strict=True):
        db = rolling_db(samples, t, TIMELINE_STEP_S)
        points.append(TimelinePoint(
            t=t,
            wpm=rolling_wpm(turns, t),
            volume_db=db if db is not None else default_db,
            hand_energy=energy,
        ))
    return points
