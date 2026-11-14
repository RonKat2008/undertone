"""Hand motion signals: smoothed energy, fidgeting while the other person talks, frozen hands.

Events may be unsorted and contain non-finite ts or hand_energy; those are dropped.
Times are seconds since session start. Nothing raises.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from backend.contracts import MotionEvent

SMOOTH_TAU_S = 3.0     # time constant of the exponential smoothing
FIDGET_GAP_S = 5.0     # max gap between fidget events that still counts as one streak
FROZEN_ENERGY = 0.15   # below this, hands count as frozen even if not "still"


def _clamp(energy: float) -> float:
    return min(1.0, max(0.0, energy))


def _clean(events: Sequence[MotionEvent]) -> list[MotionEvent]:
    """Finite events sorted by ts (stable, so equal-ts events keep input order)."""
    kept = [e for e in events if math.isfinite(e.ts) and math.isfinite(e.hand_energy)]
    return sorted(kept, key=lambda e: e.ts)


def _ema_step(ema: float | None, prev_ts: float, event: MotionEvent) -> float:
    energy = _clamp(event.hand_energy)
    if ema is None:
        return energy
    alpha = max(1.0 - math.exp(-max(0.0, event.ts - prev_ts) / SMOOTH_TAU_S), 0.0)
    return ema + alpha * (energy - ema)


def smoothed_series(events: Sequence[MotionEvent], times: Sequence[float]) -> list[float]:
    """smoothed_energy at each time, in one pass over the events (output follows `times`)."""
    ordered = _clean(events)
    order = sorted(range(len(times)), key=lambda i: times[i])
    out = [0.0] * len(times)
    ema: float | None = None
    prev_ts = 0.0
    idx = 0
    for i in order:
        while idx < len(ordered) and ordered[idx].ts <= times[i]:
            ema = _ema_step(ema, prev_ts, ordered[idx])
            prev_ts = ordered[idx].ts
            idx += 1
        out[i] = round(ema, 3) if ema is not None else 0.0
    return out


def smoothed_energy(events: Sequence[MotionEvent], at: float) -> float:
    """Time-based EMA of clamped hand energy over events with ts <= at; 0.0 if none."""
    return smoothed_series(events, [at])[0]


def _is_fidget_other(event: MotionEvent) -> bool:
    return event.state == "fidget" and event.speaker_context == "other"


def fidget_while_other_s(events: Sequence[MotionEvent], now: float) -> float:
    """Length of the current fidget-while-other streak ending at the latest event <= now."""
    past = [e for e in _clean(events) if e.ts <= now]
    if not past or not _is_fidget_other(past[-1]) or now - past[-1].ts > FIDGET_GAP_S:
        return 0.0
    first = past[-1]
    for event in reversed(past[:-1]):
        if not _is_fidget_other(event) or first.ts - event.ts > FIDGET_GAP_S:
            break
        first = event
    return round(past[-1].ts - first.ts, 2)


def fidget_while_other_total_s(events: Sequence[MotionEvent],
                               until: float | None = None) -> float:
    """Session total: gaps between consecutive fidget/other events at most FIDGET_GAP_S apart."""
    ordered = [e for e in _clean(events) if until is None or e.ts <= until]
    total = sum(
        b.ts - a.ts
        for a, b in zip(ordered, ordered[1:])
        if _is_fidget_other(a) and _is_fidget_other(b) and b.ts - a.ts <= FIDGET_GAP_S
    )
    return round(total, 2)


def _in_window(events: Sequence[MotionEvent], lo: float, hi: float) -> list[MotionEvent]:
    return [e for e in _clean(events) if lo <= e.ts <= hi]


def hands_frozen(events: Sequence[MotionEvent], lo: float, hi: float) -> bool:
    """True iff [lo, hi] has events and every one is still or below FROZEN_ENERGY."""
    window = _in_window(events, lo, hi)
    return bool(window) and all(
        e.state == "still" or e.hand_energy < FROZEN_ENERGY for e in window)


def mean_energy(events: Sequence[MotionEvent], lo: float, hi: float) -> float | None:
    """Mean clamped hand energy of events in [lo, hi]; None if none."""
    window = _in_window(events, lo, hi)
    return sum(_clamp(e.hand_energy) for e in window) / len(window) if window else None
