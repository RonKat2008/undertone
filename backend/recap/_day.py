"""The wearer's LOCAL calendar day: zone resolution, day bounds, and the day's conversations.

Other reports (and growth's daily mission) cut days in UTC; this recap deliberately uses the local
day, because "today" for a person ends at their midnight, not at UTC midnight. The zone is the
`tz` query value when given (an IANA name), else the machine's zone (the backend runs on the
wearer's own computer).
"""

from __future__ import annotations

import math
import os
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone, tzinfo
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from backend.db import DB
from backend.graph._load import load_input
from backend.graph._rows import Conversation, GraphInput

DAY_S = 86_400
LOCALTIME = Path("/etc/localtime")


@dataclass(frozen=True)
class Zone:
    tz: tzinfo
    name: str


def parse_zone(name: str) -> Zone:
    """An IANA zone name -> Zone. Raises ValueError for unknown names."""
    try:
        return Zone(ZoneInfo(name), name)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError(f"unknown time zone {name!r}") from exc


def _offset_name(tz: tzinfo) -> str:
    offset = datetime.now(tz).utcoffset() or timedelta(0)
    minutes = int(offset.total_seconds() // 60)
    sign = "+" if minutes >= 0 else "-"
    return f"UTC{sign}{abs(minutes) // 60:02d}:{abs(minutes) % 60:02d}"


def local_zone() -> Zone:
    """The machine's zone: $TZ, else the /etc/localtime link, else the current fixed offset."""
    env = os.environ.get("TZ", "").lstrip(":")
    if env:
        try:
            return parse_zone(env)
        except ValueError:
            pass
    try:
        target = str(LOCALTIME.resolve())
        if "zoneinfo/" in target:
            return parse_zone(target.split("zoneinfo/", 1)[1])
    except (OSError, ValueError):
        pass
    tz = datetime.now().astimezone().tzinfo or timezone.utc
    return Zone(tz, _offset_name(tz))


def today(zone: Zone, now: float) -> date:
    return datetime.fromtimestamp(now, zone.tz).date()


def bounds(day: date, zone: Zone) -> tuple[float, float]:
    """[start, end) of the local day in unix seconds (23 or 25 hours long on clock-change days)."""
    start = datetime(day.year, day.month, day.day, tzinfo=zone.tz)
    nxt = day + timedelta(days=1)
    end = datetime(nxt.year, nxt.month, nxt.day, tzinfo=zone.tz)
    return start.timestamp(), end.timestamp()


def local_day(ts: float, zone: Zone) -> date:
    return datetime.fromtimestamp(ts, zone.tz).date()


def on_day(convs: tuple[Conversation, ...], day: date, zone: Zone) -> tuple[Conversation, ...]:
    """Real conversations (not practice rounds) that started on the local day, oldest first."""
    start, end = bounds(day, zone)
    found = [c for c in convs if start <= c.started_ts < end and c.summary.mode != "practice"]
    return tuple(sorted(found, key=lambda c: c.started_ts))


def load_days(db: DB, first: date, zone: Zone, now: float) -> GraphInput:
    """Everything stored from the start of local day `first` until now (reads only, no LLM)."""
    start, _ = bounds(first, zone)
    days = max(1, math.ceil((now - start) / DAY_S) + 1)
    return load_input(db, days, now)
