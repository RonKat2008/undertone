"""Weekly report (plan.md 4.0, 4.9): progress against the wearer's own baseline, as information.

Baseline per metric = median of the wearer's sessions before the week. With no earlier
sessions, the week is split chronologically: baseline = median of the first half, current =
median of the second half (a single session gives from == to). Wording describes behaviour,
never the person, and never grades.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from statistics import median

from backend.contracts import DebriefMetric, DebriefNumbers, TrendPoint, WeeklyReport
from backend.db import DB
from backend.growth._store import StoredSession, load_sessions, utc_today

WEEK_DAYS = 7
METRICS: tuple[DebriefMetric, ...] = ("talk_ratio", "interruptions", "questions", "fillers_per_min", "wpm")
LOWER_IS_BETTER: frozenset[str] = frozenset({"talk_ratio", "interruptions", "fillers_per_min"})
HIGHER_IS_BETTER: frozenset[str] = frozenset({"questions"})
MIN_RELATIVE_GAIN = 0.05  # below this an improvement reads as noise
NO_SESSIONS = "No conversations this week yet."
HELD_STEADY = "Your numbers held steady against your usual this week."


@dataclass(frozen=True)
class _Change:
    metric: DebriefMetric
    before: float
    now: float


def _round(metric: str, value: float) -> float:
    return round(value, 1 if metric == "wpm" else 2)


def _fmt(value: float) -> str:
    return f"{value:g}" if value == int(value) else f"{value:.2f}".rstrip("0").rstrip(".")


def _pct(value: float) -> str:
    return f"{value:.0%}"


def _medians(sessions: Sequence[StoredSession]) -> dict[str, float]:
    return {m: _round(m, median(float(getattr(s.numbers, m)) for s in sessions)) for m in METRICS}


def _is_better(metric: str, value: float, baseline: float) -> bool:
    if metric in LOWER_IS_BETTER:
        return value < baseline
    if metric in HIGHER_IS_BETTER:
        return value > baseline
    return False  # wpm: no direction; closer to usual is not scored


def _relative_gain(change: _Change) -> float:
    if change.metric in LOWER_IS_BETTER:
        return (change.before - change.now) / change.before if change.before > 0 else 0.0
    if change.metric in HIGHER_IS_BETTER:
        return (change.now - change.before) / max(change.before, 1.0)
    return 0.0


_SENTENCES: dict[str, Callable[[_Change], str]] = {
    "talk_ratio": lambda c: f"You talked {_pct(c.now)} of the time, down from {_pct(c.before)} against your usual.",
    "interruptions": lambda c: (f"Interruptions fell from {_fmt(c.before)} to {_fmt(c.now)} per conversation "
                                "against your usual."),
    "questions": lambda c: f"You asked {_fmt(c.now)} questions per conversation, up from {_fmt(c.before)}.",
    "fillers_per_min": lambda c: (f"Fillers fell from {_fmt(c.before)} to {_fmt(c.now)} a minute "
                                  "against your usual."),
}


def _biggest_improvement(changes: Sequence[_Change]) -> str:
    gains = [(c, _relative_gain(c)) for c in changes if c.metric in _SENTENCES]
    best = max(gains, key=lambda pair: pair[1], default=None)
    if best is None or best[1] < MIN_RELATIVE_GAIN:
        return HELD_STEADY
    return _SENTENCES[best[0].metric](best[0])


def _baseline_and_current(before: Sequence[StoredSession],
                          week: Sequence[StoredSession]) -> tuple[dict[str, float], dict[str, float]]:
    if before:
        return _medians(before), _medians(week)
    if len(week) == 1:
        only = _medians(week)
        return only, only
    half = len(week) // 2
    return _medians(week[:half]), _medians(week[half:])


def _score(session: StoredSession, baseline: dict[str, float]) -> int:
    n: DebriefNumbers = session.numbers
    return sum(1 for m in METRICS if _is_better(m, float(getattr(n, m)), baseline[m]))


def weekly_report(sessions: Sequence[StoredSession], today: date) -> WeeklyReport:
    week_start = today - timedelta(days=WEEK_DAYS - 1)
    ordered = sorted(sessions, key=lambda s: s.started_at)
    before = [s for s in ordered if s.day < week_start]
    week = [s for s in ordered if week_start <= s.day <= today]
    if not week:
        return WeeklyReport(week_of=week_start.isoformat(), biggest_improvement=NO_SESSIONS)
    baseline, current = _baseline_and_current(before, week)
    changes = [_Change(metric=m, before=baseline[m], now=current[m]) for m in METRICS]
    trend = [TrendPoint(metric=c.metric, from_=c.before, to_=c.now) for c in changes]
    best = max(week, key=lambda s: (_score(s, baseline), s.started_at))
    return WeeklyReport(week_of=week_start.isoformat(), trend=trend, best_session_id=best.session_id,
                        biggest_improvement=_biggest_improvement(changes))


def report_for(db: DB, today: date | None = None) -> WeeklyReport:
    return weekly_report(load_sessions(db), today if today is not None else utc_today())
