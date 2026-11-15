"""SQLite storage for practice results: one new table, nothing else in the database touched."""

from __future__ import annotations

from backend.contracts import PracticeGoals, PracticeResult, PracticeResultSummary
from backend.db import DB

SCHEMA = """
CREATE TABLE IF NOT EXISTS practice_results (
  id TEXT PRIMARY KEY, started_at TEXT NOT NULL, coach_id TEXT NOT NULL, overall INTEGER NOT NULL,
  data_json TEXT NOT NULL
);
"""


def ensure_table(db: DB) -> None:
    """CREATE TABLE IF NOT EXISTS: cheap, so it runs before every read and write."""
    db.execute(SCHEMA.strip().rstrip(";"))


def save_result(db: DB, result: PracticeResult) -> None:
    ensure_table(db)
    db.execute("INSERT OR REPLACE INTO practice_results (id, started_at, coach_id, overall, data_json) "
               "VALUES (?, ?, ?, ?, ?)",
               (result.id, result.started_at, result.coach_id, result.overall, result.model_dump_json()))


def load_result(db: DB, result_id: str) -> PracticeResult | None:
    ensure_table(db)
    rows = db.query("SELECT data_json FROM practice_results WHERE id = ?", (result_id,))
    return PracticeResult.model_validate_json(rows[0]["data_json"]) if rows else None


def latest_result(db: DB) -> PracticeResult | None:
    ensure_table(db)
    rows = db.query("SELECT data_json FROM practice_results ORDER BY started_at DESC LIMIT 1")
    return PracticeResult.model_validate_json(rows[0]["data_json"]) if rows else None


def summarise(result: PracticeResult) -> PracticeResultSummary:
    checked = [c for c in result.previous_goals if c.met is not None]
    return PracticeResultSummary(
        id=result.id, coach_name=result.coach_name, started_at=result.started_at, duration_s=result.duration_s,
        overall=result.overall, answers=len(result.answers),
        goals_met=sum(1 for c in checked if c.met) if checked else None, goals_checked=len(checked),
    )


def list_results(db: DB, limit: int = 50) -> list[PracticeResultSummary]:
    ensure_table(db)
    rows = db.query("SELECT data_json FROM practice_results ORDER BY started_at DESC LIMIT ?", (limit,))
    return [summarise(PracticeResult.model_validate_json(r["data_json"])) for r in rows]


def current_goals(db: DB) -> PracticeGoals:
    latest = latest_result(db)
    if latest is None:
        return PracticeGoals()
    return PracticeGoals(result_id=latest.id, started_at=latest.started_at, coach_name=latest.coach_name,
                         overall=latest.overall, goals=latest.goals)
