"""Load stored rows into GraphInput. Reuses growth's session reader; reads only, never calls the LLM.

Sessions without cached topics get keyword topics computed inline (cheap, deterministic) so
the graph is never topic-less while the background refresh catches up.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from backend.contracts import BookmarkReview, DebriefNumbers, SessionSummary
from backend.db import DB
from backend.graph._aliases import topic_map
from backend.graph._cache import load_topics
from backend.graph._commitments import load_states
from backend.graph._merge import map_labels
from backend.graph._rows import Conversation, GraphInput, HabitHit, Line, Promise
from backend.graph._topics import keyword_topics, merge_labels
from backend.growth._store import StoredSession, load_sessions
from backend.relationships import relationships_by_person

log = logging.getLogger(__name__)

SECONDS_PER_DAY = 86_400
FOLLOW_UP_MATCH_S = 2.0  # a debrief bookmark review belongs to the bookmark within this many seconds


def to_unix(iso: str) -> float:
    parsed = datetime.fromisoformat(iso)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.timestamp()


def transcript_text(lines: tuple[Line, ...]) -> str:
    return "\n".join(f"{ln.speaker}: {ln.text}" for ln in lines if ln.text.strip())


def load_lines(db: DB, session_id: str) -> tuple[Line, ...]:
    return tuple(Line(speaker=t.speaker, text=t.text, start=t.start, end=t.end)
                 for t in db.load_turns(session_id))


def _follow_up(reviews: list[BookmarkReview], ts: float) -> str:
    match = next((r for r in reviews if r.source == "promise" and abs(r.ts - ts) <= FOLLOW_UP_MATCH_S), None)
    return (match.follow_up or "").strip() if match else ""


def _promises(db: DB, s: StoredSession) -> tuple[Promise, ...]:
    rows = db.query("SELECT id, ts, data_json FROM bookmarks WHERE session_id = ? AND source = 'promise' "
                    "ORDER BY ts, id", (s.session_id,))
    reviews = s.debrief.bookmarks if s.debrief else []
    out: list[Promise] = []
    for r in rows:
        try:
            text = (json.loads(r["data_json"]).get("text") or "").strip()
        except (json.JSONDecodeError, AttributeError):
            text = ""
        ts = float(r["ts"] or 0.0)
        out.append(Promise(bookmark_id=int(r["id"]), ts=ts, text=text, follow_up=_follow_up(reviews, ts)))
    return tuple(out)


def _summary(s: StoredSession) -> SessionSummary:
    if s.summary is not None:
        return s.summary.model_copy(update={"person_id": s.person_id})
    n = s.numbers
    return SessionSummary(
        session_id=s.session_id, started_at=s.started_at, duration_s=s.duration_s, coach_name=s.coach_name,
        mode=s.mode, person_id=s.person_id, headline_fact=s.headline,  # type: ignore[arg-type]
        numbers=DebriefNumbers(**n.model_dump()))


def _conversation(db: DB, s: StoredSession, cached: tuple[str, ...] | None,
                  known: list[str], canon: dict[str, str]) -> Conversation:
    lines = load_lines(db, s.session_id)
    raw = cached if cached is not None else merge_labels(keyword_topics(transcript_text(lines)), known)
    topics = map_labels(raw, canon)
    return Conversation(
        session_id=s.session_id, started_ts=to_unix(s.started_at), duration_s=s.duration_s,
        coach_id=s.coach_id, person_id=s.person_id, talk_ratio=s.numbers.talk_ratio, wpm=s.numbers.wpm,
        headline=s.headline, topics=topics,
        habits=tuple(HabitHit(rule_id=n.rule_id, loud=n.loud, ts=n.ts) for n in s.nudges),
        promises=_promises(db, s), lines=lines, summary=_summary(s),
        if_then=(s.debrief.if_then.strip() if s.debrief else ""))


def load_input(db: DB, days: int, now: float) -> GraphInput:
    """Kept, finished sessions started within `days` of `now`, newest first, plus the people store,
    stored promise states and each person's relationship (backend/relationships, read-only).
    Topic labels are mapped onto their canonical label (_aliases.py)."""
    cutoff = now - days * SECONDS_PER_DAY
    stored = [s for s in load_sessions(db) if to_unix(s.started_at) >= cutoff]
    cached = load_topics(db)
    known = sorted({label for labels in cached.values() for label in labels})
    canon = topic_map(db)
    conversations = tuple(_conversation(db, s, cached.get(s.session_id), known, canon) for s in stored)
    any_session = bool(db.query("SELECT 1 FROM sessions LIMIT 1"))
    people = tuple((p.person_id, p.name) for p in db.list_people())
    return GraphInput(conversations=conversations, people=people, has_any_session=any_session,
                      commitments=load_states(db),
                      relationships=tuple(sorted(relationships_by_person(db).items())))

