"""Runtime state: one live SessionState at most, inside one AppState."""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from backend.bus import Bus
from backend.contracts import (
    BookmarkEvent, CoachSpec, JudgeEvent, MotionEvent, NudgeEvent, NudgePolicy, SessionMode,
    SignalEvent, TurnFinalEvent,
)
from backend.db import DB


@dataclass
class SessionState:
    """Everything recorded during one conversation. Lists are append-only during a session.

    Times: `started_at` is wall clock (time.time()); event `ts`/`start`/`end` values are seconds
    since session start. Use `now_s()` to get the current session-relative time.
    """

    session_id: str
    coach: CoachSpec
    mode: SessionMode
    policy: NudgePolicy
    started_at: float = field(default_factory=time.time)
    turns: list[TurnFinalEvent] = field(default_factory=list)
    judge_results: dict[str, JudgeEvent] = field(default_factory=dict)  # by turn_id
    nudges: list[NudgeEvent] = field(default_factory=list)
    bookmarks: list[BookmarkEvent] = field(default_factory=list)
    signals: list[SignalEvent] = field(default_factory=list)
    motion: list[MotionEvent] = field(default_factory=list)
    ended_at: float | None = None

    def now_s(self) -> float:
        return round((self.ended_at or time.time()) - self.started_at, 3)

    @property
    def started_at_iso(self) -> str:
        return datetime.fromtimestamp(self.started_at, tz=timezone.utc).isoformat()

    @property
    def duration_s(self) -> float:
        return self.now_s()

    def transcript(self) -> str:
        return "\n".join(f"[{t.start:.1f}s] {t.speaker.upper()}: {t.text}" for t in self.turns)


@dataclass
class AppState:
    bus: Bus
    db: DB
    active_coach: CoachSpec
    session: SessionState | None = None
