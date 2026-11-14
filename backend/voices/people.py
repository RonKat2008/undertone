"""Voices <-> the existing people store (backend/growth/_people.py), so people cards and the
knowledge graph pick up voice-recognised people with no UI change.

An unnamed voice gets a person 'voice-<n>' named 'Unknown voice <n>'. Naming a voice moves it
(and the conversations tagged with it) to the person slugify(name), creating that person when
needed, exactly the id POST /sessions/{id}/person would use for the same name.
Manual tags are recorded in voice_manual_tags and always win over voice tags.
"""

from __future__ import annotations

import logging

from backend.contracts import Person
from backend.db import DB
from backend.growth._people import MAX_NAME_LEN, slugify

log = logging.getLogger("undertone.voices")

UNKNOWN_PREFIX = "voice-"
MANUAL_SQL = "CREATE TABLE IF NOT EXISTS voice_manual_tags (session_id TEXT PRIMARY KEY, person_id TEXT NOT NULL)"


def unknown_name(number: int) -> str:
    return f"Unknown voice {number}"


def is_unknown(person_id: str | None) -> bool:
    return bool(person_id) and person_id.startswith(UNKNOWN_PREFIX)  # type: ignore[union-attr]


def _person(db: DB, person_id: str) -> Person | None:
    rows = db.query("SELECT data_json FROM people WHERE person_id = ?", (person_id,))
    return Person.model_validate_json(rows[0]["data_json"]) if rows else None


def ensure_unknown_person(db: DB, number: int) -> str:
    pid = f"{UNKNOWN_PREFIX}{number}"
    if _person(db, pid) is None:
        db.save_person(Person(person_id=pid, name=unknown_name(number)))
    return pid


def ensure_person(db: DB, name: str) -> str:
    clean = name.strip()[:MAX_NAME_LEN]
    if not clean:
        raise ValueError("name must not be blank")
    pid = slugify(clean)
    if _person(db, pid) is None:
        db.save_person(Person(person_id=pid, name=clean))
    return pid


def person_name(db: DB, person_id: str | None) -> str | None:
    p = _person(db, person_id) if person_id else None
    return p.name if p else None


def drop_unknown_person(db: DB, person_id: str | None) -> None:
    """Remove an auto-created 'Unknown voice' person and untag its conversations."""
    if not is_unknown(person_id):
        return
    db.execute("UPDATE sessions SET person_id = NULL WHERE person_id = ?", (person_id,))
    db.execute("DELETE FROM people WHERE person_id = ?", (person_id,))


def move_person(db: DB, from_pid: str | None, to_pid: str) -> None:
    """Conversations tagged with an unknown voice's person move to the named person."""
    if not from_pid or from_pid == to_pid:
        return
    rows = db.query("SELECT session_id FROM sessions WHERE person_id = ?", (from_pid,))
    manual = manual_sessions(db)
    for r in rows:
        if r["session_id"] not in manual:
            db.set_session_person(r["session_id"], to_pid)


def manual_sessions(db: DB) -> dict[str, str]:
    db.execute(MANUAL_SQL)
    return {r["session_id"]: r["person_id"] for r in db.query("SELECT * FROM voice_manual_tags")}


def record_manual(db: DB, session_id: str, person_id: str) -> None:
    db.execute(MANUAL_SQL)
    db.execute("INSERT OR REPLACE INTO voice_manual_tags (session_id, person_id) VALUES (?, ?)",
               (session_id, person_id))


def tag_by_voice(db: DB, session_id: str, person_id: str | None) -> bool:
    """Auto-tag a conversation, unless the user tagged it by hand. True when it was written."""
    if person_id is None or session_id in manual_sessions(db):
        return False
    row = db.get_session(session_id)
    if row is None:
        return False
    current = row.get("person_id")
    if current and not is_unknown(current) and current != person_id and is_unknown(person_id):
        return False  # a named tag (from before voice memory) is not replaced by an unknown voice
    db.set_session_person(session_id, person_id)
    return True
