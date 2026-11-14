"""Pure due-day parsing for promise text. Only unambiguous, relative phrases are understood:

    "tonight", "today", "by end of day", "by eod"     -> the day the promise was made
    "tomorrow"                                        -> the next day
    "by|on|before|this <weekday>"                     -> the next such weekday after the promise day

Anything else ("next Friday", "next week", "soon", dates, a weekday equal to the promise day,
or two different deadlines in one promise) gives None. Days are UTC calendar days of the
promise timestamp (the wearer's time zone is not stored), so a promise made late in the
evening west of UTC can land one day late.
"""

from __future__ import annotations

import re
from datetime import date, datetime, timedelta, timezone

WEEKDAYS = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
_SAME_DAY = re.compile(r"\b(tonight|today|by (?:the )?end of (?:the )?day|by eod)\b")
_TOMORROW = re.compile(r"\btomorrow\b")
_WEEKDAY = re.compile(r"\b(?:by|on|before|this) (" + "|".join(WEEKDAYS) + r")\b")
_ANY_WEEKDAY = re.compile(r"\b(" + "|".join(WEEKDAYS) + r")\b")


def _candidates(text: str, made: date) -> set[date] | None:
    low = text.lower()
    out: set[date] = set()
    if _SAME_DAY.search(low):
        out.add(made)
    if _TOMORROW.search(low):
        out.add(made + timedelta(days=1))
    named = set(_ANY_WEEKDAY.findall(low))
    anchored = set(_WEEKDAY.findall(low))
    if named - anchored:
        return None  # a weekday without by/on/before/this ("next friday", "every monday")
    for day in anchored:
        ahead = (WEEKDAYS.index(day) - made.weekday()) % 7
        if ahead == 0:
            return None  # "by Friday" said on a Friday: today or next week?
        out.add(made + timedelta(days=ahead))
    return out


def due_day(text: str, made_ts: float) -> date | None:
    """The UTC day a promise is due by, or None if the text holds no single clear deadline."""
    if not text.strip():
        return None
    made = datetime.fromtimestamp(made_ts, tz=timezone.utc).date()
    found = _candidates(text, made)
    return next(iter(found)) if found and len(found) == 1 else None
