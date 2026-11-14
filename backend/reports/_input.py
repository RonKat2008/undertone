"""Report input: the graph's loaded rows split into the window and the previous equal window.

Windows are whole UTC calendar days: the current window is the last `days` days including today
([midnight of today - (days - 1), now]); the previous window is the `days` days before it. The
current window always lies inside GET /graph?days=<days>, so every node id a report returns is
a node of that graph (unless the graph's per-kind caps dropped it).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from backend.contracts import Relationship, ReportWindow
from backend.db import DB
from backend.graph._load import load_input
from backend.graph._rows import CommitmentState, Conversation, GraphInput

DAY_S = 86_400


@dataclass(frozen=True)
class ReportInput:
    now: float
    days: int
    start: float  # unix seconds, midnight UTC
    previous_start: float
    current: tuple[Conversation, ...]  # newest first
    previous: tuple[Conversation, ...]  # newest first
    people: tuple[tuple[str, str], ...]  # (person_id, name)
    commitments: tuple[CommitmentState, ...]
    relationships: tuple[tuple[str, Relationship], ...] = ()

    def relationship(self, person_id: str) -> Relationship | None:
        return dict(self.relationships).get(person_id)

    @property
    def window(self) -> ReportWindow:
        return ReportWindow(days=self.days, start=self.start, end=round(self.now, 3),
                            previous_start=self.previous_start)

    @property
    def first_day(self) -> date:
        return datetime.fromtimestamp(self.start, tz=timezone.utc).date()

    def name(self, person_id: str) -> str:
        return dict(self.people).get(person_id, person_id)

    def commitment(self, bookmark_id: int) -> CommitmentState:
        return next((s for s in self.commitments if s.bookmark_id == bookmark_id),
                    CommitmentState(bookmark_id=bookmark_id, open=True))


def window_start(now: float, days: int) -> float:
    today = datetime.fromtimestamp(now, tz=timezone.utc).date()
    first = today - timedelta(days=days - 1)
    return datetime(first.year, first.month, first.day, tzinfo=timezone.utc).timestamp()


def split(inp: GraphInput, days: int, now: float) -> ReportInput:
    """Pure: GraphInput (loaded with enough days) -> current and previous windows."""
    start = window_start(now, days)
    previous_start = start - days * DAY_S
    current = tuple(c for c in inp.conversations if start <= c.started_ts <= now)
    previous = tuple(c for c in inp.conversations if previous_start <= c.started_ts < start)
    return ReportInput(now=now, days=days, start=start, previous_start=previous_start, current=current,
                       previous=previous, people=inp.people, commitments=inp.commitments,
                       relationships=inp.relationships)


def load_report_input(db: DB, days: int, now: float) -> ReportInput:
    """Both windows' kept conversations. Reads only; never calls the LLM."""
    return split(load_input(db, 2 * days + 1, now), days, now)
