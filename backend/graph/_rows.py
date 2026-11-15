"""Immutable rows the graph is built from. Loaded by _load.py, consumed by the pure _build.py."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from backend.contracts import Relationship, SessionSummary, Speaker


@dataclass(frozen=True)
class Line:
    """One transcript turn. `start`/`end` are seconds since the session started."""

    speaker: Speaker
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class Promise:
    """A commitment the wearer made: a bookmark with source 'promise'."""

    bookmark_id: int
    ts: float  # seconds since the session started
    text: str
    follow_up: str  # the debrief's follow-up for it, or "" if none


@dataclass(frozen=True)
class HabitHit:
    rule_id: str
    loud: bool  # True = buzzed, False = quiet mark
    ts: float  # seconds since the session started


@dataclass(frozen=True)
class Conversation:
    session_id: str
    started_ts: float  # unix seconds
    duration_s: float
    coach_id: str
    person_id: str | None
    talk_ratio: float
    wpm: float
    headline: str
    topics: tuple[str, ...]  # topic labels, cached or keyword fallback
    habits: tuple[HabitHit, ...]
    promises: tuple[Promise, ...]
    lines: tuple[Line, ...]
    summary: SessionSummary
    if_then: str = ""  # the debrief's if-then plan, "" if none

    @property
    def minutes_spoken(self) -> float:
        """The wearer's own speaking minutes; falls back to duration x talk ratio without turns."""
        spoken = sum(max(0.0, ln.end - ln.start) for ln in self.lines if ln.speaker == "me")
        return (spoken or self.duration_s * self.talk_ratio) / 60


@dataclass(frozen=True)
class CommitmentState:
    """Stored done/open state of one promise. No stored row = open, closed_by None."""

    bookmark_id: int
    open: bool
    closed_by: Literal["manual", "auto"] | None = None
    closed_at: float | None = None  # unix seconds
    closed_session_id: str | None = None  # the later conversation that closed it (auto only)
    evidence: str | None = None  # the wearer's words that closed it (auto only)
    manual: bool = False  # a manual state is stored (the automatic check leaves it alone)


@dataclass(frozen=True)
class GraphInput:
    conversations: tuple[Conversation, ...]  # newest first
    people: tuple[tuple[str, str], ...]  # (person_id, name) from the people store
    has_any_session: bool  # anything stored at all, in or out of the window
    commitments: tuple[CommitmentState, ...] = ()  # stored promise states (others are open)
    relationships: tuple[tuple[str, Relationship], ...] = ()  # (person_id, effective relationship)

    def relationship(self, person_id: str) -> Relationship | None:
        return dict(self.relationships).get(person_id)

    def commitment(self, bookmark_id: int) -> CommitmentState:
        return next((s for s in self.commitments if s.bookmark_id == bookmark_id),
                    CommitmentState(bookmark_id=bookmark_id, open=True))
