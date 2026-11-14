"""Read stored sessions into one immutable shape that every growth module computes over.

Only finished sessions (ended_at set) count for growth maths. All queries are parameterised.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Any

from pydantic import ValidationError

from backend.contracts import Debrief, DebriefNumbers, Metrics, SessionSummary, TurnFinalEvent
from backend.db import DB

log = logging.getLogger(__name__)

MAX_SESSIONS = 500

# Plain behaviour labels for known nudge rule ids (prebuilt coaches). Unknown ids fall back
# to the id with underscores turned into spaces.
RULE_LABELS: dict[str, str] = {
    "hedging": "Hedging",
    "long_answer": "Long answers",
    "bury_the_answer": "Answer buried at the end",
    "missing_result": "Missing the result",
    "vague_numbers": "Vague numbers",
    "fillers": "Filler words",
    "filler": "Filler words",
    "pace": "Speaking fast",
    "interrupt": "Interrupting",
    "talk_share": "Talking most of the time",
    "long_turn": "Long turns",
    "monologue": "Long turns",
    "self_redirect": "Turning the topic to yourself",
    "no_acknowledgement": "Not acknowledging",
    "unsolicited_advice": "Unasked-for advice",
}


def rule_label(rule_id: str) -> str:
    return RULE_LABELS.get(rule_id, rule_id.replace("_", " ").capitalize())


def utc_today() -> date:
    return datetime.now(timezone.utc).date()


@dataclass(frozen=True)
class NudgeRecord:
    rule_id: str
    loud: bool  # True = buzzed (nudge), False = fired quietly (nudge.quiet)
    ts: float


@dataclass(frozen=True)
class StoredSession:
    session_id: str
    started_at: str  # ISO 8601, UTC
    day: date  # UTC calendar day of started_at
    duration_s: float
    coach_id: str
    coach_name: str
    mode: str
    person_id: str | None
    metrics: Metrics | None
    summary: SessionSummary | None
    debrief: Debrief | None
    wearer_turns: tuple[TurnFinalEvent, ...]
    nudges: tuple[NudgeRecord, ...]

    @property
    def minutes(self) -> float:
        """Wearer speaking minutes if turns exist, else session length; never below 1 s."""
        spoken = sum(max(0.0, t.end - t.start) for t in self.wearer_turns)
        return max((spoken or self.duration_s) / 60, 1 / 60)

    @property
    def numbers(self) -> DebriefNumbers:
        if self.summary is not None:
            return self.summary.numbers
        if self.debrief is not None:
            return self.debrief.numbers
        m = self.metrics or Metrics()
        return DebriefNumbers(talk_ratio=m.talk_ratio, interruptions=m.interruptions,
                              questions=m.questions, fillers_per_min=m.fillers_per_min, wpm=m.wpm)

    @property
    def headline(self) -> str:
        if self.summary is not None and self.summary.headline_fact:
            return self.summary.headline_fact
        return self.debrief.headline_fact if self.debrief is not None else ""

    def fired(self, rule_id: str) -> int:
        return sum(1 for n in self.nudges if n.rule_id == rule_id)


def _parse(model: type[Any], raw: str | None, what: str, sid: str) -> Any:
    if not raw:
        return None
    try:
        return model.model_validate_json(raw)
    except ValidationError:
        log.warning("skipping unreadable %s for session %s", what, sid)
        return None


def _day(started_at: str) -> date:
    try:
        return datetime.fromisoformat(started_at).astimezone(timezone.utc).date()
    except ValueError:
        return date.fromisoformat(started_at[:10])


def _nudges(db: DB, sid: str) -> tuple[NudgeRecord, ...]:
    rows = db.query("SELECT rule_id, ts, data_json FROM nudges WHERE session_id = ? ORDER BY ts", (sid,))
    out: list[NudgeRecord] = []
    for r in rows:
        try:
            kind = json.loads(r["data_json"]).get("type", "nudge")
        except (json.JSONDecodeError, AttributeError):
            kind = "nudge"
        if r["rule_id"]:
            out.append(NudgeRecord(rule_id=r["rule_id"], loud=kind != "nudge.quiet", ts=r["ts"] or 0.0))
    return tuple(out)


def _wearer_turns(db: DB, sid: str) -> tuple[TurnFinalEvent, ...]:
    rows = db.query("SELECT data_json FROM turns WHERE session_id = ? AND speaker = 'me' ORDER BY start",
                    (sid,))
    turns = (_parse(TurnFinalEvent, r["data_json"], "turn", sid) for r in rows)
    return tuple(t for t in turns if t is not None)


def _debrief(db: DB, sid: str) -> Debrief | None:
    rows = db.query("SELECT data_json FROM debriefs WHERE session_id = ?", (sid,))
    return _parse(Debrief, rows[0]["data_json"], "debrief", sid) if rows else None


def _from_row(db: DB, row: dict[str, Any]) -> StoredSession:
    sid = row["session_id"]
    return StoredSession(
        session_id=sid, started_at=row["started_at"], day=_day(row["started_at"]),
        duration_s=float(row["duration_s"] or 0.0), coach_id=row["coach_id"], coach_name=row["coach_name"],
        mode=row["mode"], person_id=row["person_id"],
        metrics=_parse(Metrics, row["metrics_json"], "metrics", sid),
        summary=_parse(SessionSummary, row["summary_json"], "summary", sid),
        debrief=_debrief(db, sid), wearer_turns=_wearer_turns(db, sid), nudges=_nudges(db, sid))


def load_sessions(db: DB, limit: int = MAX_SESSIONS) -> list[StoredSession]:
    """Finished sessions, newest first."""
    rows = db.query("SELECT * FROM sessions WHERE ended_at IS NOT NULL ORDER BY started_at DESC LIMIT ?",
                    (limit,))
    return [_from_row(db, dict(r)) for r in rows]


def load_session(db: DB, session_id: str) -> StoredSession | None:
    rows = db.query("SELECT * FROM sessions WHERE session_id = ?", (session_id,))
    return _from_row(db, dict(rows[0])) if rows else None
