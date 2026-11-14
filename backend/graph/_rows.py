"""Immutable rows the graph is built from. Loaded by _load.py, consumed by the pure _build.py."""

from __future__ import annotations

from dataclasses import dataclass

from backend.contracts import SessionSummary, Speaker


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

    @property
    def minutes_spoken(self) -> float:
        """The wearer's own speaking minutes; falls back to duration x talk ratio without turns."""
        spoken = sum(max(0.0, ln.end - ln.start) for ln in self.lines if ln.speaker == "me")
        return (spoken or self.duration_s * self.talk_ratio) / 60


@dataclass(frozen=True)
class GraphInput:
    conversations: tuple[Conversation, ...]  # newest first
    people: tuple[tuple[str, str], ...]  # (person_id, name) from the people store
    has_any_session: bool  # anything stored at all, in or out of the window
