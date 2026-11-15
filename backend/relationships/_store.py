"""One row per person in the app's SQLite file (same conventions as backend/graph/_cache.py:
CREATE TABLE IF NOT EXISTS on use, JSON columns, parameterised queries only).

The inferred result and the wearer's own label are separate columns: a refresh only ever writes
the inferred side, so a user label is never overwritten, and clearing it restores inference.
"""

from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass

from pydantic import ValidationError

from backend.contracts import Relationship, RelationshipKind
from backend.db import DB
from backend.relationships._blend import Memory

log = logging.getLogger("undertone.relationships")

TABLE = "relationships"
TABLE_SQL = (
    f"CREATE TABLE IF NOT EXISTS {TABLE} ("
    " person_id TEXT PRIMARY KEY, inferred_json TEXT, user_kind TEXT, user_at REAL,"
    " seen_json TEXT NOT NULL DEFAULT '[]', pending_kind TEXT, pending_count INTEGER NOT NULL DEFAULT 0,"
    " updated_at REAL NOT NULL)"
)
USER_EVIDENCE = "you set this label"


@dataclass(frozen=True)
class Row:
    person_id: str
    memory: Memory
    user_kind: str | None
    user_at: float | None
    seen: frozenset[str]  # kept session ids folded into `memory.inferred`


def ensure_table(db: DB) -> None:
    db.execute(TABLE_SQL)  # idempotent and cheap


def _inferred(raw: str | None, pid: str) -> Relationship | None:
    if not raw:
        return None
    try:
        return Relationship.model_validate_json(raw)
    except ValidationError:
        log.warning("unreadable stored relationship for %s", pid)
        return None


def _seen(raw: str | None) -> frozenset[str]:
    try:
        value = json.loads(raw or "[]")
    except json.JSONDecodeError:
        return frozenset()
    return frozenset(str(v) for v in value) if isinstance(value, list) else frozenset()


def _row(r: object) -> Row:
    pid = r["person_id"]  # type: ignore[index]
    memory = Memory(inferred=_inferred(r["inferred_json"], pid), pending_kind=r["pending_kind"],  # type: ignore[index]
                    pending_count=int(r["pending_count"] or 0))  # type: ignore[index]
    return Row(person_id=pid, memory=memory, user_kind=r["user_kind"], user_at=r["user_at"],  # type: ignore[index]
               seen=_seen(r["seen_json"]))  # type: ignore[index]


def load_row(db: DB, person_id: str) -> Row | None:
    ensure_table(db)
    rows = db.query(f"SELECT * FROM {TABLE} WHERE person_id = ?", (person_id,))
    return _row(rows[0]) if rows else None


def load_rows(db: DB) -> dict[str, Row]:
    ensure_table(db)
    return {r["person_id"]: _row(r) for r in db.query(f"SELECT * FROM {TABLE} ORDER BY person_id")}


def save_memory(db: DB, person_id: str, memory: Memory, seen: frozenset[str]) -> None:
    """Write the inferred side only; the user columns are left as they are."""
    ensure_table(db)
    raw = memory.inferred.model_dump_json() if memory.inferred is not None else None
    db.execute(
        f"INSERT INTO {TABLE} (person_id, inferred_json, seen_json, pending_kind, pending_count, updated_at) "
        "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(person_id) DO UPDATE SET inferred_json = excluded.inferred_json, "
        "seen_json = excluded.seen_json, pending_kind = excluded.pending_kind, "
        "pending_count = excluded.pending_count, updated_at = excluded.updated_at",
        (person_id, raw, json.dumps(sorted(seen)), memory.pending_kind, memory.pending_count, time.time()))


def save_user_kind(db: DB, person_id: str, kind: RelationshipKind | None) -> None:
    """Set (or with None, clear) the wearer's own label."""
    ensure_table(db)
    now = time.time()
    db.execute(
        f"INSERT INTO {TABLE} (person_id, user_kind, user_at, updated_at) VALUES (?, ?, ?, ?) "
        "ON CONFLICT(person_id) DO UPDATE SET user_kind = excluded.user_kind, user_at = excluded.user_at, "
        "updated_at = excluded.updated_at",
        (person_id, kind, now if kind else None, now))


def effective(row: Row | None) -> Relationship | None:
    """What everyone else sees: the user label if set, else the inferred result."""
    if row is None:
        return None
    inferred = row.memory.inferred
    if row.user_kind is None:
        return inferred
    base = inferred or Relationship(person_id=row.person_id, kind="unknown", confidence=0, source="user")
    return base.model_copy(update={"kind": row.user_kind, "confidence": 1.0, "source": "user",
                                   "evidence": [USER_EVIDENCE], "updated_at": row.user_at})


def placeholder(person_id: str) -> Relationship:
    """Shown for a person nothing has been inferred for yet."""
    return Relationship(person_id=person_id, kind="unknown", confidence=0.0, evidence=["not analysed yet"],
                        source="rules", based_on_sessions=0, updated_at=None)
