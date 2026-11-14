"""Wearer loudness: rolling level, session baseline, and quiet/ok/loud hysteresis.

Samples are (ts, db) pairs in dBFS (0 = full scale, about -60 = silence); ts is seconds
since session start. Inputs may be unsorted and contain non-finite values. Nothing raises.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from typing import Literal

VolumeState = Literal["quiet", "ok", "loud"]

SILENCE_DB = -50.0       # samples below this are silence and excluded everywhere
VOLUME_WINDOW_S = 3.0    # rolling window for the live level
BASELINE_SPAN_S = 30.0   # the first 30 s of voiced audio form the session baseline
ENTER_DB = 6.0           # |delta| above this enters loud / quiet from ok
EXIT_DB = 3.0            # loud / quiet hold while |delta| stays above this
SILENT_DB = -60.0        # nominal level of silence


def _voiced(samples: Sequence[tuple[float, float]]) -> list[tuple[float, float]]:
    """Finite, non-silent samples sorted by ts."""
    kept = [(ts, db) for ts, db in samples
            if math.isfinite(ts) and math.isfinite(db) and db >= SILENCE_DB]
    return sorted(kept, key=lambda s: s[0])


def _mean(values: Sequence[float]) -> float | None:
    return sum(values) / len(values) if values else None


def _round1(value: float | None) -> float | None:
    return round(value, 1) if value is not None else None


def rolling_db(samples: Sequence[tuple[float, float]], at: float,
               window_s: float = VOLUME_WINDOW_S) -> float | None:
    """Mean voiced level in [at - window_s, at]; holds the last voiced sample through pauses."""
    past = [s for s in _voiced(samples) if s[0] <= at]
    if not past:
        return None
    in_window = [db for ts, db in past if ts >= at - window_s]
    return _round1(_mean(in_window) if in_window else past[-1][1])


def session_baseline_db(samples: Sequence[tuple[float, float]]) -> float | None:
    """Mean voiced level over the first BASELINE_SPAN_S of voiced audio, once established."""
    voiced = _voiced(samples)
    if not voiced:
        return None
    span_end = voiced[0][0] + BASELINE_SPAN_S
    if voiced[-1][0] < span_end:
        return None
    return _round1(_mean([db for ts, db in voiced if ts <= span_end]))


def _state_from_ok(delta: float) -> VolumeState:
    if delta > ENTER_DB:
        return "loud"
    if delta < -ENTER_DB:
        return "quiet"
    return "ok"


def next_volume_state(prev: VolumeState, db: float | None,
                      baseline: float | None) -> VolumeState:
    """Hysteresis: enter loud/quiet beyond ENTER_DB, leave only once within EXIT_DB."""
    if db is None or baseline is None or not math.isfinite(db) or not math.isfinite(baseline):
        return prev
    delta = db - baseline
    if prev == "loud" and delta > EXIT_DB:
        return "loud"
    if prev == "quiet" and delta < -EXIT_DB:
        return "quiet"
    return _state_from_ok(delta)


def bucket_db(samples: Sequence[tuple[float, float]], lo: float, hi: float) -> float | None:
    """Mean voiced level with lo <= ts < hi (timeline buckets); None if none."""
    return _round1(_mean([db for ts, db in _voiced(samples) if lo <= ts < hi]))
