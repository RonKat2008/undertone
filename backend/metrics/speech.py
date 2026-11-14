"""Pure speech metrics over finalised turns.

A turn's words are assumed spread uniformly over [start, end]; when a turn is clipped to a
time range its words/fillers are prorated by the fraction of its duration inside the range.
Turns with end <= start contribute nothing. Inputs may be unsorted.
"""

from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass

from backend.contracts import TurnFinalEvent
from backend.metrics.text import count_words, find_fillers


@dataclass(frozen=True)
class _Portion:
    """The part of a wearer turn inside some range."""

    seconds: float
    words: float


def _duration(turn: TurnFinalEvent) -> float:
    return max(0.0, turn.end - turn.start)


def _overlap(turn: TurnFinalEvent, lo: float, hi: float) -> float:
    return max(0.0, min(turn.end, hi) - max(turn.start, lo))


def _wearer(turns: Iterable[TurnFinalEvent]) -> tuple[TurnFinalEvent, ...]:
    me = (t for t in turns if t.speaker == "me" and _duration(t) > 0)
    return tuple(sorted(me, key=lambda t: (t.start, t.end)))


def _portion(turn: TurnFinalEvent, lo: float, hi: float) -> _Portion:
    seconds = _overlap(turn, lo, hi)
    return _Portion(seconds, count_words(turn.text) * seconds / _duration(turn))


def _wpm(words: float, seconds: float) -> float:
    return words / (seconds / 60.0) if seconds > 0 else 0.0


def _take(portions: Iterable[_Portion], need_s: float) -> _Portion:
    """Accumulate portions until need_s seconds are filled, prorating the last one."""
    seconds = 0.0
    words = 0.0
    for p in portions:
        remaining = need_s - seconds
        if remaining <= 0:
            break
        used = min(p.seconds, remaining)
        seconds += used
        words += p.words * used / p.seconds if p.seconds > 0 else 0.0
    return _Portion(seconds, words)


def talk_ratio(turns: Sequence[TurnFinalEvent], until: float | None = None) -> float:
    """Wearer speaking seconds / all speaking seconds, turns clipped to <= until."""
    hi = float("inf") if until is None else until
    me_s = 0.0
    all_s = 0.0
    for t in turns:
        if _duration(t) <= 0:
            continue
        s = _overlap(t, t.start, hi)
        all_s += s
        if t.speaker == "me":
            me_s += s
    return round(me_s / all_s, 3) if all_s > 0 else 0.0


def rolling_wpm(turns: Sequence[TurnFinalEvent], at: float, window_s: float = 15.0) -> float:
    """Wearer pace over the last window_s seconds of their speech up to `at`."""
    backwards = (_portion(t, t.start, at) for t in reversed(_wearer(turns)) if t.start < at)
    # within a turn the last seconds are taken, but words are uniform so proration is the same
    taken = _take(backwards, window_s)
    return round(_wpm(taken.words, taken.seconds), 1)


def window_wpm(
    turns: Sequence[TurnFinalEvent], lo: float, hi: float, min_speech_s: float = 3.0,
) -> float | None:
    """Wearer pace from turn portions inside [lo, hi]; None if under min_speech_s of speech."""
    portions = tuple(_portion(t, lo, hi) for t in _wearer(turns))
    seconds = sum(p.seconds for p in portions)
    if seconds <= 0 or seconds < min_speech_s:
        return None
    return round(_wpm(sum(p.words for p in portions), seconds), 1)


def baseline_from_first(turns: Sequence[TurnFinalEvent], first_s: float = 30.0) -> float | None:
    """Wearer pace over the first first_s seconds of their speech; None until available."""
    forwards = (_portion(t, t.start, t.end) for t in _wearer(turns))
    taken = _take(forwards, first_s)
    if taken.seconds <= 0 or taken.seconds < first_s:
        return None
    return round(_wpm(taken.words, taken.seconds), 1)


def fillers_per_min(
    turns: Sequence[TurnFinalEvent],
    filler_words: Sequence[str],
    at: float,
    window_s: float = 60.0,
    min_speech_s: float = 15.0,
) -> float:
    """Wearer fillers per minute of wearer speech over the wall-clock range [at - window_s, at]."""
    lo = at - window_s
    seconds = 0.0
    fillers = 0.0
    for t in _wearer(turns):
        inside = _overlap(t, lo, at)
        if inside <= 0:
            continue
        seconds += inside
        fillers += len(find_fillers(t.text, filler_words)) * inside / _duration(t)
    if seconds <= 0:
        return 0.0
    return round(fillers / (max(seconds, min_speech_s) / 60.0), 2)
