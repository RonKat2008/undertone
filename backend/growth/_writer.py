"""Write one finished session in the same shape brain.py stores it. Used by tests and the seed script."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from backend.contracts import (
    Debrief, DebriefNumbers, Metrics, NudgeEvent, NudgeQuietEvent, SessionSummary, TurnFinalEvent,
)
from backend.db import DB


@dataclass(frozen=True)
class SessionSpec:
    session_id: str
    started_at: datetime  # timezone-aware
    numbers: DebriefNumbers
    wearer_texts: tuple[str, ...] = ()
    other_texts: tuple[str, ...] = ()
    nudges: tuple[tuple[str, bool], ...] = ()  # (rule_id, loud)
    person_id: str | None = None
    duration_s: float = 600.0
    coach_id: str = "listener"
    coach_name: str = "Listener"
    mode: str = "regular"
    headline: str = ""
    one_fix: str = "Your turns ran long."
    if_then: str = "When you finish a point, ask a question."
    notes: tuple[str, ...] = field(default_factory=tuple)
    volume_db: float = -20.0


def _turns(spec: SessionSpec) -> list[TurnFinalEvent]:
    """Alternate other/me turns spread evenly across the session."""
    pairs: list[tuple[str, str]] = []
    for i in range(max(len(spec.wearer_texts), len(spec.other_texts))):
        if i < len(spec.other_texts):
            pairs.append(("other", spec.other_texts[i]))
        if i < len(spec.wearer_texts):
            pairs.append(("me", spec.wearer_texts[i]))
    if not pairs:
        return []
    slot = spec.duration_s / len(pairs)
    out: list[TurnFinalEvent] = []
    for i, (speaker, text) in enumerate(pairs):
        start = round(i * slot, 2)
        out.append(TurnFinalEvent(turn_id=f"t{i}", speaker=speaker, text=text,  # type: ignore[arg-type]
                                  start=start, end=round(start + slot * 0.95, 2), wpm=spec.numbers.wpm))
    return out


def write_session(db: DB, spec: SessionSpec) -> None:
    start = spec.started_at.astimezone(timezone.utc)
    sid = spec.session_id
    db.create_session(sid, spec.coach_id, spec.coach_name, spec.mode, start.isoformat())
    for turn in _turns(spec):
        db.save_turn(sid, turn)
    for i, (rule_id, loud) in enumerate(spec.nudges):
        ts = round((i + 1) * spec.duration_s / (len(spec.nudges) + 1), 1)
        if loud:
            db.save_nudge(sid, NudgeEvent(rule_id=rule_id, haptic="tap", message="pause", reason="seeded",
                                          latency_ms=0, budget_left=0, ts=ts))
        else:
            quiet = NudgeQuietEvent(rule_id=rule_id, haptic="tap", message="pause", reason="seeded", ts=ts)
            db.execute("INSERT INTO nudges (session_id, rule_id, ts, data_json) VALUES (?, ?, ?, ?)",
                       (sid, rule_id, ts, quiet.model_dump_json()))
    n = spec.numbers
    debrief = Debrief(headline_fact=spec.headline or "A conversation.", strength="You asked a clear question.",
                      one_fix=spec.one_fix, if_then=spec.if_then, numbers=n, best_moment_quote="",
                      notes=list(spec.notes))
    db.save_debrief(sid, debrief, None)
    metrics = Metrics(talk_ratio=n.talk_ratio, interruptions=n.interruptions, questions=n.questions,
                      fillers_per_min=n.fillers_per_min, wpm=n.wpm, volume_db=spec.volume_db)
    summary = SessionSummary(session_id=sid, started_at=start.isoformat(), duration_s=spec.duration_s,
                             coach_name=spec.coach_name, mode=spec.mode,  # type: ignore[arg-type]
                             person_id=spec.person_id, headline_fact=debrief.headline_fact, numbers=n)
    db.end_session(sid, (start + timedelta(seconds=spec.duration_s)).isoformat(), spec.duration_s,
                   metrics, summary)
    if spec.person_id is not None:
        db.set_session_person(sid, spec.person_id)
