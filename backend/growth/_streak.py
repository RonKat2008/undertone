"""Streak (plan.md 4.0, 4.9): practice days, not perfect days.

Rules:
- A practice day is a UTC day with at least one finished coached conversation.
- Counting starts today; if today has no conversation yet, it starts from yesterday (today
  is still open, so it simply is not counted yet).
- One freeze per run: a single missed day with a practice day before it is repaired and the
  run continues past it. The repaired day bridges the run but does not add to `days`.
  Two missed days in a row, or a second single miss, end the count.
- The wording layer never speaks of a streak ending; this module only returns numbers.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import date, timedelta

from backend.contracts import Streak
from backend.db import DB
from backend.growth._store import load_sessions, utc_today

WEEK_DAYS = 7
ONE_DAY = timedelta(days=1)


def _count_run(practised: frozenset[date], start: date) -> tuple[int, bool]:
    """Walk back from `start`. Returns (practice days in the run, freeze used)."""
    count = 0
    freeze_used = False
    cursor = start
    while True:
        if cursor in practised:
            count += 1
        elif not freeze_used and (cursor - ONE_DAY) in practised:
            freeze_used = True
        else:
            return count, freeze_used
        cursor -= ONE_DAY


def compute_streak(days: Iterable[date], today: date) -> Streak:
    practised = frozenset(d for d in days if d <= today)
    week = [(today - timedelta(days=WEEK_DAYS - 1 - i)) in practised for i in range(WEEK_DAYS)]
    if not practised:
        return Streak(days=0, freeze_available=True, week=week)
    start = today if today in practised else today - ONE_DAY
    count, freeze_used = _count_run(practised, start)
    if count == 0:
        return Streak(days=0, freeze_available=True, week=week)
    return Streak(days=count, freeze_available=not freeze_used, week=week)


def streak_for(db: DB, today: date | None = None) -> Streak:
    day = today if today is not None else utc_today()
    return compute_streak((s.day for s in load_sessions(db)), day)
