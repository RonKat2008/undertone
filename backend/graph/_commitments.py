"""Commitment (promise) status: stored done/open state, set by hand or by the automatic check.

    commitment_status   one row per promise that has a state; no row = open
                        source 'manual' (POST /graph/commitment/{id}) or 'auto' (_closing.py).
                        A manual row always wins: the automatic check never touches it.
    commitment_checks   cache of automatic checks, one row per (promise, later session) pair.
"""

from __future__ import annotations

import time
from typing import Literal

from backend.db import DB
from backend.graph._rows import CommitmentState

ClosedBy = Literal["manual", "auto"]
STATUS_SQL = (
    "CREATE TABLE IF NOT EXISTS commitment_status ("
    " bookmark_id INTEGER PRIMARY KEY, open INTEGER NOT NULL, source TEXT NOT NULL,"
    " session_id TEXT, evidence TEXT, updated_at REAL NOT NULL)"
)
CHECKS_SQL = (
    "CREATE TABLE IF NOT EXISTS commitment_checks ("
    " bookmark_id INTEGER NOT NULL, session_id TEXT NOT NULL, done INTEGER NOT NULL, evidence TEXT,"
    " created_at REAL NOT NULL, PRIMARY KEY (bookmark_id, session_id))"
)


def ensure_tables(db: DB) -> None:
    db.execute(STATUS_SQL)
    db.execute(CHECKS_SQL)


def parse_commitment_id(raw: str) -> int | None:
    """'commitment:12' or '12' -> 12; anything else -> None."""
    value = raw.split(":", 1)[1] if raw.startswith("commitment:") else raw
    return int(value) if value.isdigit() else None


def is_promise(db: DB, bookmark_id: int) -> bool:
    return bool(db.query("SELECT 1 FROM bookmarks WHERE id = ? AND source = 'promise'", (bookmark_id,)))


def _state(row: object) -> CommitmentState:
    r = dict(row)  # type: ignore[call-overload]
    is_open = bool(r["open"])
    return CommitmentState(
        bookmark_id=int(r["bookmark_id"]), open=is_open, closed_by=None if is_open else r["source"],
        closed_at=None if is_open else float(r["updated_at"]),
        closed_session_id=None if is_open else r["session_id"], evidence=None if is_open else r["evidence"],
        manual=r["source"] == "manual")


def load_states(db: DB) -> tuple[CommitmentState, ...]:
    ensure_tables(db)
    rows = db.query("SELECT bookmark_id, open, source, session_id, evidence, updated_at "
                    "FROM commitment_status ORDER BY bookmark_id")
    return tuple(_state(r) for r in rows)


def get_state(db: DB, bookmark_id: int) -> CommitmentState:
    ensure_tables(db)
    rows = db.query("SELECT bookmark_id, open, source, session_id, evidence, updated_at "
                    "FROM commitment_status WHERE bookmark_id = ?", (bookmark_id,))
    return _state(rows[0]) if rows else CommitmentState(bookmark_id=bookmark_id, open=True)


def set_manual(db: DB, bookmark_id: int, is_open: bool) -> CommitmentState:
    """Mark done (open=False) or reopen (open=True) by hand. Overrides any automatic state."""
    ensure_tables(db)
    db.execute("INSERT OR REPLACE INTO commitment_status (bookmark_id, open, source, session_id, evidence, "
               "updated_at) VALUES (?, ?, 'manual', NULL, NULL, ?)", (bookmark_id, int(is_open), time.time()))
    return get_state(db, bookmark_id)


def close_automatically(db: DB, bookmark_id: int, session_id: str, evidence: str) -> None:
    """Close from a later conversation, unless any state (manual or auto) is already stored."""
    ensure_tables(db)
    db.execute("INSERT OR IGNORE INTO commitment_status (bookmark_id, open, source, session_id, evidence, "
               "updated_at) VALUES (?, 0, 'auto', ?, ?, ?)", (bookmark_id, session_id, evidence, time.time()))


def save_check(db: DB, bookmark_id: int, session_id: str, done: bool, evidence: str) -> None:
    ensure_tables(db)
    db.execute("INSERT OR REPLACE INTO commitment_checks (bookmark_id, session_id, done, evidence, created_at) "
               "VALUES (?, ?, ?, ?, ?)", (bookmark_id, session_id, int(done), evidence, time.time()))


def pending_checks(db: DB, limit: int) -> list[tuple[int, str]]:
    """(bookmark_id, later session_id) pairs not checked yet: a promise with no stored state, made in a
    kept conversation tagged with a person, and a later kept, finished conversation with that person.
    Oldest later conversation first."""
    ensure_tables(db)
    rows = db.query(
        "SELECT b.id AS bookmark_id, l.session_id AS later FROM bookmarks b "
        "JOIN sessions p ON p.session_id = b.session_id "
        "JOIN sessions l ON l.person_id = p.person_id AND l.started_at > p.started_at "
        "LEFT JOIN commitment_status cs ON cs.bookmark_id = b.id "
        "LEFT JOIN commitment_checks cc ON cc.bookmark_id = b.id AND cc.session_id = l.session_id "
        "WHERE b.source = 'promise' AND p.person_id IS NOT NULL AND (p.kept IS NULL OR p.kept = 1) "
        "AND l.ended_at IS NOT NULL AND (l.kept IS NULL OR l.kept = 1) "
        "AND cs.bookmark_id IS NULL AND cc.bookmark_id IS NULL "
        "ORDER BY l.started_at, b.id LIMIT ?", (limit,))
    return [(int(r["bookmark_id"]), r["later"]) for r in rows]
