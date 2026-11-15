"""Day recap cache: one row per (local day, zone) in its own table (no existing table is altered).

A row is reused while its fingerprint (the day's conversation ids, their tagged people, the zone)
matches; a new or re-tagged conversation that day changes it, so the next read regenerates.
"""

from __future__ import annotations

import hashlib
from collections.abc import Sequence

from pydantic import BaseModel, ConfigDict, Field

from backend.contracts import DayRecap
from backend.db import DB
from backend.graph._rows import Conversation
from backend.recap._goals import GoalSpec

VERSION = "1"
TABLE = """CREATE TABLE IF NOT EXISTS day_recaps (
  date TEXT NOT NULL, tz TEXT NOT NULL, fingerprint TEXT NOT NULL, data_json TEXT NOT NULL,
  updated_at REAL NOT NULL, PRIMARY KEY (date, tz)
)"""


class StoredRecap(BaseModel):
    """INTERNAL: the public recap plus the measurable goal specs behind its goals."""

    model_config = ConfigDict(extra="ignore")

    recap: DayRecap
    goal_specs: list[GoalSpec] = Field(default_factory=list)


def ensure_table(db: DB) -> None:
    db.execute(TABLE)


def fingerprint(convs: Sequence[Conversation], tz: str) -> str:
    parts = sorted(f"{c.session_id}:{c.person_id or ''}" for c in convs)
    return hashlib.sha256("|".join([VERSION, tz, *parts]).encode()).hexdigest()[:24]


def load(db: DB, day: str, tz: str) -> tuple[str, StoredRecap] | None:
    ensure_table(db)
    rows = db.query("SELECT fingerprint, data_json FROM day_recaps WHERE date = ? AND tz = ?", (day, tz))
    if not rows:
        return None
    return rows[0]["fingerprint"], StoredRecap.model_validate_json(rows[0]["data_json"])


def save(db: DB, day: str, tz: str, fp: str, stored: StoredRecap, now: float) -> None:
    ensure_table(db)
    db.execute("INSERT OR REPLACE INTO day_recaps (date, tz, fingerprint, data_json, updated_at) "
               "VALUES (?, ?, ?, ?, ?)", (day, tz, fp, stored.model_dump_json(), now))
