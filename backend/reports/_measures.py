"""Pure measures over conversations, window comparisons and the small-sample rules.

Small-sample rules (the only place they live):
  MIN_COMPARE  rates (talk share, pace, fillers, interruptions and questions per conversation,
               habit rate) are compared with the previous window only when BOTH windows have at
               least 3 conversations; counts (conversations, minutes) only when the previous
               window has at least one conversation. Otherwise change/better are null and
               direction is "insufficient_data".
  SAME_BAND    a relative change under 10% reads as "same".
  MIN_GROUP    "with this person / on this topic versus your other conversations" needs at
               least 3 conversations on each side; below that `ratio` is null and nothing is
               `meaningful`.
  CLEAR_RATIO  and MIN_ABS: a difference is meaningful only when the ratio is >= 1.25 (or
               <= 0.8) AND the absolute gap reaches the per-measure minimum.
A window with no conversations gives null rates, never zeros.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import date, datetime, timedelta, timezone

from backend.contracts import ReportBucket, ReportComparison, ReportDayPoint, ReportDelta, ReportMeasure
from backend.graph._rows import Conversation

MIN_COMPARE = 3
MIN_GROUP = 3
SAME_BAND = 0.10
CLEAR_RATIO = 1.25
MIN_ABS: dict[str, float] = {"talk_ratio": 0.08, "wpm": 10.0, "fillers_per_min": 0.5, "interruptions": 0.5,
                             "questions": 0.5}
COUNTS: frozenset[str] = frozenset({"conversations", "minutes_spoken"})
LOWER_IS_BETTER: frozenset[str] = frozenset({"talk_ratio", "interruptions", "fillers_per_min",
                                             "habit_per_conversation"})
HIGHER_IS_BETTER: frozenset[str] = frozenset({"questions"})
RATES: tuple[ReportMeasure, ...] = ("talk_ratio", "wpm", "fillers_per_min", "interruptions", "questions")
BUCKET_DAYS = 7


def rounded(metric: str, value: float) -> float:
    return round(value, 3 if metric == "talk_ratio" else 1 if metric in ("wpm", "minutes_spoken") else 2)


def _weighted(convs: Sequence[Conversation], value: Callable[[Conversation], float],
              weight: Callable[[Conversation], float]) -> float | None:
    if not convs:
        return None
    total = sum(weight(c) for c in convs)
    if total <= 0:
        return sum(value(c) for c in convs) / len(convs)
    return sum(value(c) * weight(c) for c in convs) / total


def measure(convs: Sequence[Conversation], metric: str) -> float | None:
    """One measure over conversations. Counts are 0 for none; rates are None for none.
    talk share is weighted by conversation length, pace and fillers by the wearer's speaking time,
    interruptions and questions are per conversation."""
    if metric == "conversations":
        return float(len(convs))
    if metric == "minutes_spoken":
        return rounded(metric, sum(c.minutes_spoken for c in convs))
    if not convs:
        return None
    if metric == "talk_ratio":
        value = _weighted(convs, lambda c: c.talk_ratio, lambda c: c.duration_s)
    elif metric == "wpm":
        spoke = [c for c in convs if c.wpm > 0]
        value = _weighted(spoke, lambda c: c.wpm, lambda c: c.minutes_spoken) if spoke else None
    elif metric == "fillers_per_min":
        value = _weighted(convs, lambda c: c.summary.numbers.fillers_per_min, lambda c: c.minutes_spoken)
    else:
        value = sum(float(getattr(c.summary.numbers, metric)) for c in convs) / len(convs)
    return None if value is None else rounded(metric, value)


def better_of(metric: str, change: float) -> bool | None:
    if metric in LOWER_IS_BETTER:
        return change < 0
    if metric in HIGHER_IS_BETTER:
        return change > 0
    return None


def compare(metric: ReportMeasure, current: float | None, previous: float | None, n: int, n_previous: int,
            enough: bool) -> ReportDelta:
    """Delta between two values. `enough` is the caller's small-sample verdict."""
    base = ReportDelta(metric=metric, current=current, previous=previous, sample=n, previous_sample=n_previous)
    if not enough or current is None or previous is None:
        return base
    change = rounded(metric, current - previous)
    relative = abs(change) / abs(previous) if previous else (1.0 if change else 0.0)
    if relative < SAME_BAND:
        return base.model_copy(update={"change": change, "direction": "same"})
    return base.model_copy(update={"change": change, "direction": "up" if change > 0 else "down",
                                   "better": better_of(metric, change)})


def window_delta(metric: ReportMeasure, current: Sequence[Conversation],
                 previous: Sequence[Conversation]) -> ReportDelta:
    enough = (len(previous) >= 1 if metric in COUNTS
              else len(current) >= MIN_COMPARE and len(previous) >= MIN_COMPARE)
    return compare(metric, measure(current, metric), measure(previous, metric), len(current), len(previous),
                   enough)


def comparison(metric: ReportMeasure, group: Sequence[Conversation],
               elsewhere: Sequence[Conversation]) -> ReportComparison:
    value, usual = measure(group, metric), measure(elsewhere, metric)
    base = ReportComparison(metric=metric, value=value, usual=usual, sample=len(group), usual_sample=len(elsewhere))
    if len(group) < MIN_GROUP or len(elsewhere) < MIN_GROUP or value is None or not usual:
        return base
    ratio = round(value / usual, 2)
    clear = (ratio >= CLEAR_RATIO or ratio <= 1 / CLEAR_RATIO) and abs(value - usual) >= MIN_ABS.get(metric, 0.0)
    return base.model_copy(update={"ratio": ratio, "meaningful": clear})


def strongest(comparisons: Sequence[ReportComparison]) -> ReportComparison | None:
    """The meaningful comparison furthest from 1x (ties: list order)."""
    found = [(c, c.ratio) for c in comparisons if c.meaningful and c.ratio]
    best = max(found, key=lambda pair: max(pair[1], 1 / pair[1]), default=None)
    return best[0] if best else None


def utc_day(ts: float) -> date:
    return datetime.fromtimestamp(ts, tz=timezone.utc).date()


def _day_point(day: date, convs: Sequence[Conversation]) -> ReportDayPoint:
    hits = [h for c in convs for h in c.habits]
    return ReportDayPoint(
        day=day.isoformat(), conversations=len(convs), minutes_spoken=measure(convs, "minutes_spoken") or 0.0,
        talk_ratio=measure(convs, "talk_ratio"), wpm=measure(convs, "wpm"),
        fillers_per_min=measure(convs, "fillers_per_min"),
        interruptions=sum(c.summary.numbers.interruptions for c in convs),
        questions=sum(c.summary.numbers.questions for c in convs),
        nudges=sum(1 for h in hits if h.loud), quiet_marks=sum(1 for h in hits if not h.loud))


def day_series(first: date, days: int, convs: Sequence[Conversation]) -> list[ReportDayPoint]:
    """One point per UTC day of the window, oldest first; empty days have zero counts and null rates."""
    by_day: dict[date, list[Conversation]] = {}
    for c in convs:
        by_day.setdefault(utc_day(c.started_ts), []).append(c)
    return [_day_point(d, by_day.get(d, [])) for d in (first + timedelta(days=i) for i in range(days))]


def buckets(first: date, days: int, items: Sequence[tuple[float, int]]) -> list[ReportBucket]:
    """Weekly buckets from the window's first day; items are (unix ts, count). The last bucket may be short."""
    out: list[ReportBucket] = []
    for offset in range(0, days, BUCKET_DAYS):
        start = first + timedelta(days=offset)
        span = min(BUCKET_DAYS, days - offset)
        end = start + timedelta(days=span)
        out.append(ReportBucket(start=start.isoformat(), days=span,
                                count=sum(n for ts, n in items if start <= utc_day(ts) < end)))
    return out
