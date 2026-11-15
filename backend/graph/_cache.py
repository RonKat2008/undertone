"""Per-session topic cache in the app's SQLite file (same conventions as backend/db.py:
CREATE TABLE IF NOT EXISTS, a JSON column, parameterised queries only)."""

from __future__ import annotations

import json
import logging
import time

from backend.db import DB

log = logging.getLogger(__name__)

TABLE_SQL = (
    "CREATE TABLE IF NOT EXISTS session_topics ("
    " session_id TEXT PRIMARY KEY, source TEXT NOT NULL, labels_json TEXT NOT NULL,"
    " created_at REAL NOT NULL)"
)


def ensure_table(db: DB) -> None:
    db.execute(TABLE_SQL)  # idempotent and cheap


def _labels(raw: str, sid: str) -> tuple[str, ...]:
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        log.warning("unreadable cached topics for session %s", sid)
        return ()
    return tuple(str(v) for v in value) if isinstance(value, list) else ()


def load_topics(db: DB) -> dict[str, tuple[str, ...]]:
    """Every cached session's topic labels, by session id."""
    ensure_table(db)
    rows = db.query("SELECT session_id, labels_json FROM session_topics ORDER BY session_id")
    return {r["session_id"]: _labels(r["labels_json"], r["session_id"]) for r in rows}


def load_topics_ordered(db: DB) -> list[tuple[str, tuple[str, ...]]]:
    """(session_id, labels) in the order they were cached (oldest first)."""
    ensure_table(db)
    rows = db.query("SELECT session_id, labels_json FROM session_topics ORDER BY created_at, session_id")
    return [(r["session_id"], _labels(r["labels_json"], r["session_id"])) for r in rows]


def save_topics(db: DB, session_id: str, labels: tuple[str, ...], source: str) -> None:
    ensure_table(db)
    db.execute(
        "INSERT OR REPLACE INTO session_topics (session_id, source, labels_json, created_at) VALUES (?, ?, ?, ?)",
        (session_id, source, json.dumps(list(labels)), time.time()))


def missing_sessions(db: DB, limit: int) -> list[str]:
    """Finished sessions with no cached topics yet, newest first."""
    ensure_table(db)
    rows = db.query(
        "SELECT s.session_id FROM sessions s LEFT JOIN session_topics t ON t.session_id = s.session_id "
        "WHERE s.ended_at IS NOT NULL AND (s.kept IS NULL OR s.kept = 1) AND t.session_id IS NULL "
        "ORDER BY s.started_at DESC LIMIT ?",
        (limit,))
    return [r["session_id"] for r in rows]
