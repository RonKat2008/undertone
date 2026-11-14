"""SQLite storage (stdlib sqlite3). Parameterised queries only. JSON columns hold models.

One connection, used from the asyncio loop thread only (check_same_thread=False so
FastAPI sync routes in the threadpool can read; writes are tiny).
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any, TypeVar

from pydantic import BaseModel

from backend.contracts import (
    BookmarkEvent, CoachSpec, DailyMission, Debrief, HabitProfile, JudgeEvent, NudgeEvent, NudgeQuietEvent,
    Person, TurnFinalEvent,
)

M = TypeVar("M", bound=BaseModel)

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY, coach_id TEXT NOT NULL, coach_name TEXT NOT NULL,
  mode TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, duration_s REAL,
  person_id TEXT, metrics_json TEXT, summary_json TEXT
);
CREATE TABLE IF NOT EXISTS turns (
  session_id TEXT NOT NULL, turn_id TEXT NOT NULL, speaker TEXT NOT NULL,
  start REAL, end REAL, data_json TEXT NOT NULL, PRIMARY KEY (session_id, turn_id)
);
CREATE TABLE IF NOT EXISTS judge_results (
  session_id TEXT NOT NULL, turn_id TEXT NOT NULL, source TEXT, latency_ms REAL,
  data_json TEXT NOT NULL, PRIMARY KEY (session_id, turn_id)
);
CREATE TABLE IF NOT EXISTS nudges (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, rule_id TEXT,
  ts REAL, data_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, source TEXT,
  ts REAL, data_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS debriefs (
  session_id TEXT PRIMARY KEY, audio_url TEXT, data_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS coaches (
  id TEXT PRIMARY KEY, kind TEXT, data_json TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1), data_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS missions (
  date TEXT PRIMARY KEY, data_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  person_id TEXT PRIMARY KEY, name TEXT NOT NULL, data_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL
);
"""


def _dump(model: BaseModel) -> str:
    return model.model_dump_json(by_alias=True)


class DB:
    def __init__(self, path: Path | str) -> None:
        self.path = str(path)
        self._lock = threading.Lock()
        self.conn = sqlite3.connect(self.path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    # ---- generic ----
    def execute(self, sql: str, params: tuple[Any, ...] = ()) -> None:
        with self._lock:
            self.conn.execute(sql, params)
            self.conn.commit()

    def query(self, sql: str, params: tuple[Any, ...] = ()) -> list[sqlite3.Row]:
        with self._lock:
            return list(self.conn.execute(sql, params).fetchall())

    def close(self) -> None:
        self.conn.close()

    # ---- sessions ----
    def create_session(self, session_id: str, coach_id: str, coach_name: str, mode: str,
                       started_at: str) -> None:
        self.execute(
            "INSERT OR REPLACE INTO sessions (session_id, coach_id, coach_name, mode, started_at) "
            "VALUES (?, ?, ?, ?, ?)", (session_id, coach_id, coach_name, mode, started_at))

    def end_session(self, session_id: str, ended_at: str, duration_s: float,
                    metrics: BaseModel, summary: BaseModel | None) -> None:
        self.execute(
            "UPDATE sessions SET ended_at = ?, duration_s = ?, metrics_json = ?, summary_json = ? "
            "WHERE session_id = ?",
            (ended_at, duration_s, _dump(metrics), _dump(summary) if summary else None, session_id))

    def set_session_person(self, session_id: str, person_id: str | None) -> None:
        self.execute("UPDATE sessions SET person_id = ? WHERE session_id = ?", (person_id, session_id))

    def list_sessions(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self.query("SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?", (limit,))
        return [dict(r) for r in rows]

    def get_session(self, session_id: str) -> dict[str, Any] | None:
        rows = self.query("SELECT * FROM sessions WHERE session_id = ?", (session_id,))
        return dict(rows[0]) if rows else None

    # ---- per-session records ----
    def save_turn(self, session_id: str, turn: TurnFinalEvent) -> None:
        self.execute(
            "INSERT OR REPLACE INTO turns (session_id, turn_id, speaker, start, end, data_json) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (session_id, turn.turn_id, turn.speaker, turn.start, turn.end, _dump(turn)))

    def load_turns(self, session_id: str) -> list[TurnFinalEvent]:
        rows = self.query("SELECT data_json FROM turns WHERE session_id = ? ORDER BY start", (session_id,))
        return [TurnFinalEvent.model_validate_json(r["data_json"]) for r in rows]

    def save_judge(self, session_id: str, judge: JudgeEvent) -> None:
        self.execute(
            "INSERT OR REPLACE INTO judge_results (session_id, turn_id, source, latency_ms, data_json) "
            "VALUES (?, ?, ?, ?, ?)",
            (session_id, judge.turn_id, judge.source, judge.latency_ms, _dump(judge)))

    def load_judges(self, session_id: str) -> list[JudgeEvent]:
        rows = self.query("SELECT data_json FROM judge_results WHERE session_id = ?", (session_id,))
        return [JudgeEvent.model_validate_json(r["data_json"]) for r in rows]

    def save_nudge(self, session_id: str, nudge: NudgeEvent | NudgeQuietEvent) -> None:
        """Buzzed nudges and quiet marks share the table; `type` in the JSON tells them apart."""
        self.execute("INSERT INTO nudges (session_id, rule_id, ts, data_json) VALUES (?, ?, ?, ?)",
                     (session_id, nudge.rule_id, nudge.ts, _dump(nudge)))

    def load_nudges(self, session_id: str) -> list[NudgeEvent]:
        rows = self.query("SELECT data_json FROM nudges WHERE session_id = ? ORDER BY ts", (session_id,))
        return [NudgeEvent.model_validate_json(r["data_json"]) for r in rows
                if '"type":"nudge.quiet"' not in r["data_json"].replace(" ", "")]

    def save_bookmark(self, session_id: str, bm: BookmarkEvent) -> None:
        self.execute("INSERT INTO bookmarks (session_id, source, ts, data_json) VALUES (?, ?, ?, ?)",
                     (session_id, bm.source, bm.ts, _dump(bm)))

    def load_bookmarks(self, session_id: str) -> list[BookmarkEvent]:
        rows = self.query("SELECT data_json FROM bookmarks WHERE session_id = ? ORDER BY ts", (session_id,))
        return [BookmarkEvent.model_validate_json(r["data_json"]) for r in rows]

    def save_debrief(self, session_id: str, debrief: Debrief, audio_url: str | None) -> None:
        self.execute("INSERT OR REPLACE INTO debriefs (session_id, audio_url, data_json) VALUES (?, ?, ?)",
                     (session_id, audio_url, _dump(debrief)))

    def load_debrief(self, session_id: str) -> tuple[Debrief, str | None] | None:
        rows = self.query("SELECT data_json, audio_url FROM debriefs WHERE session_id = ?", (session_id,))
        if not rows:
            return None
        return Debrief.model_validate_json(rows[0]["data_json"]), rows[0]["audio_url"]

    # ---- coaches ----
    def save_coach(self, coach: CoachSpec) -> None:
        self.execute("INSERT OR REPLACE INTO coaches (id, kind, data_json) VALUES (?, ?, ?)",
                     (coach.id, coach.kind, _dump(coach)))

    def load_coach(self, coach_id: str) -> CoachSpec | None:
        rows = self.query("SELECT data_json FROM coaches WHERE id = ?", (coach_id,))
        return CoachSpec.model_validate_json(rows[0]["data_json"]) if rows else None

    def list_coaches(self) -> list[CoachSpec]:
        rows = self.query("SELECT data_json FROM coaches ORDER BY id")
        return [CoachSpec.model_validate_json(r["data_json"]) for r in rows]

    # ---- profile / missions / people ----
    def save_profile(self, profile: HabitProfile) -> None:
        self.execute("INSERT OR REPLACE INTO profile (id, data_json) VALUES (1, ?)", (_dump(profile),))

    def load_profile(self) -> HabitProfile | None:
        rows = self.query("SELECT data_json FROM profile WHERE id = 1")
        return HabitProfile.model_validate_json(rows[0]["data_json"]) if rows else None

    def save_mission(self, mission: DailyMission) -> None:
        self.execute("INSERT OR REPLACE INTO missions (date, data_json) VALUES (?, ?)",
                     (mission.date, _dump(mission)))

    def load_mission(self, date: str) -> DailyMission | None:
        rows = self.query("SELECT data_json FROM missions WHERE date = ?", (date,))
        return DailyMission.model_validate_json(rows[0]["data_json"]) if rows else None

    def save_person(self, person: Person) -> None:
        self.execute("INSERT OR REPLACE INTO people (person_id, name, data_json) VALUES (?, ?, ?)",
                     (person.person_id, person.name, _dump(person)))

    def list_people(self) -> list[Person]:
        rows = self.query("SELECT data_json FROM people ORDER BY name")
        return [Person.model_validate_json(r["data_json"]) for r in rows]

    # ---- small key/value (active coach id, etc.) ----
    def kv_set(self, key: str, value: Any) -> None:
        self.execute("INSERT OR REPLACE INTO kv (key, value_json) VALUES (?, ?)", (key, json.dumps(value)))

    def kv_get(self, key: str, default: Any = None) -> Any:
        rows = self.query("SELECT value_json FROM kv WHERE key = ?", (key,))
        return json.loads(rows[0]["value_json"]) if rows else default
