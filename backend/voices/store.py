"""Voice memory tables in the app's SQLite file (same conventions as backend/db.py and
backend/graph/_cache.py: CREATE TABLE IF NOT EXISTS, parameterised queries only).

Embeddings are stored as little-endian float32 BLOBs, only in this local database.

    voice_profiles   one row per remembered voice (the wearer is voice_id 'wearer')
    voice_exemplars  up to VoiceConfig.exemplar_cap embeddings per voice, tagged by session
    voice_sightings  who was heard in which conversation, with what similarity and decision
    voice_runs       per-conversation run: status, report, and the ORIGINAL turns (so a rerun
                     starts from what Deepgram gave, not from an earlier correction)
    voice_words      final Deepgram words with timings and labels, per conversation
    voice_conflicts  a heard name that disagrees with the voice's name
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import numpy as np

from backend.contracts import TurnFinalEvent
from backend.db import DB
from backend.voices.types import Exemplar, TimedWord, Voiceprint

log = logging.getLogger("undertone.voices")

WEARER_ID = "wearer"

SCHEMA = (
    "CREATE TABLE IF NOT EXISTS voice_profiles ("
    " voice_id TEXT PRIMARY KEY, number INTEGER, name TEXT, person_id TEXT, is_wearer INTEGER NOT NULL DEFAULT 0,"
    " wearer_state TEXT, model TEXT NOT NULL, centroid BLOB NOT NULL, samples INTEGER NOT NULL DEFAULT 0,"
    " seconds REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_heard_at TEXT)",
    "CREATE TABLE IF NOT EXISTS voice_exemplars ("
    " id INTEGER PRIMARY KEY AUTOINCREMENT, voice_id TEXT NOT NULL, session_id TEXT NOT NULL,"
    " seconds REAL NOT NULL, embedding BLOB NOT NULL)",
    "CREATE TABLE IF NOT EXISTS voice_sightings ("
    " session_id TEXT NOT NULL, voice_id TEXT NOT NULL, role TEXT NOT NULL, similarity REAL,"
    " margin REAL, decision TEXT NOT NULL, seconds REAL NOT NULL, embedding BLOB, heard_at TEXT NOT NULL,"
    " PRIMARY KEY (session_id, voice_id))",
    "CREATE TABLE IF NOT EXISTS voice_runs ("
    " session_id TEXT PRIMARY KEY, status TEXT NOT NULL, processed_at TEXT NOT NULL, model TEXT,"
    " original_turns_json TEXT, report_json TEXT)",
    "CREATE TABLE IF NOT EXISTS voice_words (session_id TEXT PRIMARY KEY, words_json TEXT NOT NULL)",
    "CREATE TABLE IF NOT EXISTS voice_conflicts ("
    " id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, voice_id TEXT NOT NULL,"
    " voice_name TEXT, heard_name TEXT NOT NULL, created_at TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0)",
    "CREATE INDEX IF NOT EXISTS voice_exemplars_voice ON voice_exemplars (voice_id)",
    "CREATE INDEX IF NOT EXISTS voice_sightings_voice ON voice_sightings (voice_id)",
)


@dataclass(frozen=True)
class VoiceRow:
    voice_id: str
    number: int | None
    name: str | None
    person_id: str | None
    is_wearer: bool
    wearer_state: str | None
    model: str
    samples: int
    seconds: float
    created_at: str
    last_heard_at: str | None
    voiceprint: Voiceprint


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def to_blob(v: np.ndarray) -> bytes:
    return np.asarray(v, dtype="<f4").tobytes()


def from_blob(b: bytes | None) -> np.ndarray:
    return np.frombuffer(b or b"", dtype="<f4").astype(np.float32)


def ensure_tables(db: DB) -> None:
    for sql in SCHEMA:  # constants above, never user input
        db.execute(sql)


@contextmanager
def transaction(db: DB) -> Iterator[Any]:
    """Several writes as one unit, under the DB's own lock."""
    with db._lock:  # noqa: SLF001 - the DB exposes no transaction helper; same lock as execute()
        try:
            yield db.conn
            db.conn.commit()
        except Exception:
            db.conn.rollback()
            raise


# ---------- voices ----------
def _exemplars(db: DB, voice_id: str) -> tuple[Exemplar, ...]:
    rows = db.query("SELECT session_id, seconds, embedding FROM voice_exemplars WHERE voice_id = ? ORDER BY id",
                    (voice_id,))
    return tuple(Exemplar(r["session_id"], from_blob(r["embedding"]), float(r["seconds"])) for r in rows)


def _voice(db: DB, r: Any) -> VoiceRow:
    vp = Voiceprint(r["voice_id"], from_blob(r["centroid"]), _exemplars(db, r["voice_id"]), int(r["samples"]))
    return VoiceRow(voice_id=r["voice_id"], number=r["number"], name=r["name"], person_id=r["person_id"],
                    is_wearer=bool(r["is_wearer"]), wearer_state=r["wearer_state"], model=r["model"],
                    samples=int(r["samples"]), seconds=float(r["seconds"]), created_at=r["created_at"],
                    last_heard_at=r["last_heard_at"], voiceprint=vp)


def list_voices(db: DB, include_wearer: bool = False) -> list[VoiceRow]:
    where = "" if include_wearer else "WHERE is_wearer = 0 "
    rows = db.query(f"SELECT * FROM voice_profiles {where}ORDER BY COALESCE(last_heard_at, created_at) DESC")
    return [_voice(db, r) for r in rows]


def get_voice(db: DB, voice_id: str) -> VoiceRow | None:
    rows = db.query("SELECT * FROM voice_profiles WHERE voice_id = ?", (voice_id,))
    return _voice(db, rows[0]) if rows else None


def wearer(db: DB) -> VoiceRow | None:
    return get_voice(db, WEARER_ID)


def next_number(db: DB) -> int:
    rows = db.query("SELECT COALESCE(MAX(number), 0) AS n FROM voice_profiles")
    return int(rows[0]["n"]) + 1


def save_voice(db: DB, row: VoiceRow) -> None:
    """Insert or replace a voice and all its exemplars."""
    vp = row.voiceprint
    seconds = sum(e.seconds for e in vp.exemplars) if vp.exemplars else row.seconds
    with transaction(db) as conn:
        conn.execute(
            "INSERT OR REPLACE INTO voice_profiles (voice_id, number, name, person_id, is_wearer, wearer_state,"
            " model, centroid, samples, seconds, created_at, last_heard_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
            (row.voice_id, row.number, row.name, row.person_id, 1 if row.is_wearer else 0, row.wearer_state,
             row.model, to_blob(vp.centroid), vp.samples, seconds, row.created_at, row.last_heard_at))
        conn.execute("DELETE FROM voice_exemplars WHERE voice_id = ?", (row.voice_id,))
        conn.executemany(
            "INSERT INTO voice_exemplars (voice_id, session_id, seconds, embedding) VALUES (?,?,?,?)",
            [(row.voice_id, e.session_id, e.seconds, to_blob(e.embedding)) for e in vp.exemplars])


def delete_voice(db: DB, voice_id: str) -> None:
    """Forget a voice: its voiceprint, exemplars and the embeddings kept with its sightings."""
    with transaction(db) as conn:
        conn.execute("DELETE FROM voice_exemplars WHERE voice_id = ?", (voice_id,))
        conn.execute("DELETE FROM voice_sightings WHERE voice_id = ?", (voice_id,))
        conn.execute("DELETE FROM voice_conflicts WHERE voice_id = ?", (voice_id,))
        conn.execute("DELETE FROM voice_profiles WHERE voice_id = ?", (voice_id,))


# ---------- sightings ----------
@dataclass(frozen=True)
class Sighting:
    session_id: str
    voice_id: str
    role: str
    similarity: float | None
    margin: float | None
    decision: str  # wearer | matched | new | manual | named
    seconds: float
    embedding: np.ndarray | None
    heard_at: str


def save_sightings(db: DB, session_id: str, sightings: Sequence[Sighting]) -> None:
    with transaction(db) as conn:
        conn.execute("DELETE FROM voice_sightings WHERE session_id = ?", (session_id,))
        conn.executemany(
            "INSERT OR REPLACE INTO voice_sightings (session_id, voice_id, role, similarity, margin, decision,"
            " seconds, embedding, heard_at) VALUES (?,?,?,?,?,?,?,?,?)",
            [(s.session_id, s.voice_id, s.role, s.similarity, s.margin, s.decision, s.seconds,
              None if s.embedding is None else to_blob(s.embedding), s.heard_at) for s in sightings])


def _sighting(r: Any) -> Sighting:
    emb = from_blob(r["embedding"]) if r["embedding"] is not None else None
    return Sighting(r["session_id"], r["voice_id"], r["role"], r["similarity"], r["margin"], r["decision"],
                    float(r["seconds"]), emb, r["heard_at"])


def sightings_for_session(db: DB, session_id: str) -> list[Sighting]:
    rows = db.query("SELECT * FROM voice_sightings WHERE session_id = ? ORDER BY seconds DESC", (session_id,))
    return [_sighting(r) for r in rows]


def sightings_for_voice(db: DB, voice_id: str) -> list[Sighting]:
    rows = db.query("SELECT * FROM voice_sightings WHERE voice_id = ? ORDER BY heard_at DESC", (voice_id,))
    return [_sighting(r) for r in rows]


def update_sighting(db: DB, session_id: str, old_voice: str, new_voice: str, decision: str) -> None:
    db.execute("UPDATE OR REPLACE voice_sightings SET voice_id = ?, decision = ? WHERE session_id = ? AND voice_id = ?",
               (new_voice, decision, session_id, old_voice))


def move_sightings(db: DB, from_voice: str, to_voice: str) -> None:
    db.execute("UPDATE OR REPLACE voice_sightings SET voice_id = ? WHERE voice_id = ?", (to_voice, from_voice))
    db.execute("UPDATE voice_conflicts SET voice_id = ? WHERE voice_id = ?", (to_voice, from_voice))


# ---------- runs, words, conflicts ----------
def save_run(db: DB, session_id: str, status: str, model: str | None, report: dict[str, Any],
             original_turns: Sequence[TurnFinalEvent] | None = None) -> None:
    """Keeps the first stored original turns: a rerun never overwrites them."""
    original = None
    if original_turns is not None:
        original = json.dumps([t.model_dump(mode="json") for t in original_turns])
    db.execute(
        "INSERT INTO voice_runs (session_id, status, processed_at, model, original_turns_json, report_json)"
        " VALUES (?,?,?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET status = excluded.status,"
        " processed_at = excluded.processed_at, model = excluded.model, report_json = excluded.report_json,"
        " original_turns_json = COALESCE(voice_runs.original_turns_json, excluded.original_turns_json)",
        (session_id, status, now_iso(), model, original, json.dumps(report)))


def get_run(db: DB, session_id: str) -> dict[str, Any] | None:
    rows = db.query("SELECT * FROM voice_runs WHERE session_id = ?", (session_id,))
    if not rows:
        return None
    r = dict(rows[0])
    r["report"] = json.loads(r.pop("report_json") or "{}")
    return r


def original_turns(db: DB, session_id: str) -> list[TurnFinalEvent] | None:
    rows = db.query("SELECT original_turns_json FROM voice_runs WHERE session_id = ?", (session_id,))
    if not rows or not rows[0]["original_turns_json"]:
        return None
    return [TurnFinalEvent.model_validate(t) for t in json.loads(rows[0]["original_turns_json"])]


def save_words(db: DB, session_id: str, words: Sequence[TimedWord]) -> None:
    data = [[w.text, round(w.start, 3), round(w.end, 3), int(w.label)] for w in words]
    db.execute("INSERT OR REPLACE INTO voice_words (session_id, words_json) VALUES (?, ?)",
               (session_id, json.dumps(data)))


def load_words(db: DB, session_id: str) -> list[TimedWord]:
    rows = db.query("SELECT words_json FROM voice_words WHERE session_id = ?", (session_id,))
    if not rows:
        return []
    return [TimedWord(str(t), float(s), float(e), int(lab)) for t, s, e, lab in json.loads(rows[0]["words_json"])]


def add_conflict(db: DB, session_id: str, voice_id: str, voice_name: str | None, heard: str) -> None:
    db.execute("DELETE FROM voice_conflicts WHERE session_id = ? AND voice_id = ?", (session_id, voice_id))
    db.execute("INSERT INTO voice_conflicts (session_id, voice_id, voice_name, heard_name, created_at)"
               " VALUES (?,?,?,?,?)", (session_id, voice_id, voice_name, heard, now_iso()))


def conflicts(db: DB, voice_id: str | None = None, session_id: str | None = None) -> list[dict[str, Any]]:
    sql, params = "SELECT * FROM voice_conflicts WHERE resolved = 0", []
    if voice_id is not None:
        sql, params = sql + " AND voice_id = ?", [*params, voice_id]
    if session_id is not None:
        sql, params = sql + " AND session_id = ?", [*params, session_id]
    return [dict(r) for r in db.query(sql + " ORDER BY id", tuple(params))]


def resolve_conflicts(db: DB, voice_id: str) -> None:
    db.execute("UPDATE voice_conflicts SET resolved = 1 WHERE voice_id = ?", (voice_id,))


def replace_turns(db: DB, session_id: str, turns: Sequence[TurnFinalEvent]) -> None:
    """Swap a conversation's stored turns for corrected ones, atomically."""
    with transaction(db) as conn:
        conn.execute("DELETE FROM turns WHERE session_id = ?", (session_id,))
        conn.executemany(
            "INSERT OR REPLACE INTO turns (session_id, turn_id, speaker, start, end, data_json) VALUES (?,?,?,?,?,?)",
            [(session_id, t.turn_id, t.speaker, t.start, t.end, t.model_dump_json(by_alias=True)) for t in turns])


def clear_session_results(db: DB, session_id: str) -> None:
    """Drop one conversation's sightings and conflicts (before a rerun). Its run record, original
    turns and words stay, so the rerun starts from what Deepgram gave."""
    with transaction(db) as conn:
        conn.execute("DELETE FROM voice_sightings WHERE session_id = ?", (session_id,))
        conn.execute("DELETE FROM voice_conflicts WHERE session_id = ?", (session_id,))


def sessions_with_recordings(db: DB) -> list[str]:
    rows = db.query("SELECT session_id FROM sessions WHERE audio_s IS NOT NULL AND ended_at IS NOT NULL"
                    " AND (kept_reason IS NULL OR kept_reason NOT IN ('noise', 'sensitive')) ORDER BY started_at")
    return [r["session_id"] for r in rows]
