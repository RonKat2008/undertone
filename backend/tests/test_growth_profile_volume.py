"""A session with no real audio reports volume_db = SILENT_DB; it must not become the baseline."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from backend.contracts import DebriefNumbers
from backend.db import DB
from backend.growth._profile import compute_profile
from backend.growth._store import load_sessions
from backend.growth._writer import SessionSpec, write_session
from backend.metrics.volume import SILENCE_DB, SILENT_DB

NUMS = DebriefNumbers(talk_ratio=0.5, interruptions=0, questions=2, fillers_per_min=3, wpm=150)


@pytest.fixture
def db(tmp_path: Path) -> DB:
    return DB(tmp_path / "u.db")


def _add(db: DB, sid: str, volume_db: float, hours_ago: int) -> None:
    start = datetime(2026, 11, 14, 12, tzinfo=timezone.utc) - timedelta(hours=hours_ago)
    write_session(db, SessionSpec(session_id=sid, started_at=start, numbers=NUMS, volume_db=volume_db))


def test_silent_only_history_has_no_volume_baseline(db: DB) -> None:
    _add(db, "s1", SILENT_DB, 1)
    assert compute_profile(load_sessions(db)).baseline_volume_db is None


def test_silent_sessions_are_left_out_of_the_median(db: DB) -> None:
    _add(db, "s1", SILENT_DB, 1)
    _add(db, "s2", SILENT_DB, 2)
    _add(db, "s3", -20.0, 3)
    _add(db, "s4", SILENCE_DB - 0.5, 4)
    assert compute_profile(load_sessions(db)).baseline_volume_db == -20.0


def test_real_volumes_still_count(db: DB) -> None:
    _add(db, "s1", -18.0, 1)
    _add(db, "s2", -22.0, 2)
    assert compute_profile(load_sessions(db)).baseline_volume_db == -20.0
