"""RecurringIssue.rate is the share of sessions (0..1) in which the rule fired at least once;
clients render it as a percentage ("338%" was the bug)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from backend.contracts import DebriefNumbers
from backend.db import DB
from backend.growth._profile import compute_profile
from backend.growth._sample import seed
from backend.growth._store import load_sessions
from backend.growth._writer import SessionSpec, write_session

NUMS = DebriefNumbers(talk_ratio=0.5, interruptions=0, questions=2, fillers_per_min=3, wpm=150)


@pytest.fixture
def db(tmp_path: Path) -> DB:
    return DB(tmp_path / "u.db")


def _add(db: DB, sid: str, hours_ago: int, nudges: tuple[tuple[str, bool], ...]) -> None:
    start = datetime(2026, 11, 14, 12, tzinfo=timezone.utc) - timedelta(hours=hours_ago)
    write_session(db, SessionSpec(session_id=sid, started_at=start, numbers=NUMS, nudges=nudges))


def test_five_fires_in_one_of_two_sessions_is_half(db: DB) -> None:
    _add(db, "s1", 1, (("interrupt", True),) * 3 + (("interrupt", False),) * 2)
    _add(db, "s2", 2, ())
    issues = compute_profile(load_sessions(db)).recurring_issues
    assert [(i.rule_id, i.rate) for i in issues] == [("interrupt", 0.5)]


def test_rate_rounds_to_two_places_and_orders_by_share(db: DB) -> None:
    _add(db, "s1", 1, (("pace", True), ("fillers", True)))
    _add(db, "s2", 2, (("fillers", True),))
    _add(db, "s3", 3, ())
    issues = compute_profile(load_sessions(db)).recurring_issues
    assert [(i.rule_id, i.rate) for i in issues] == [("fillers", 0.67), ("pace", 0.33)]


def test_equal_share_ties_break_on_how_often_it_fired(db: DB) -> None:
    _add(db, "s1", 1, (("pace", True),) + (("fillers", True),) * 4)
    _add(db, "s2", 2, (("pace", True), ("fillers", True)))
    issues = compute_profile(load_sessions(db)).recurring_issues
    assert [(i.rule_id, i.rate) for i in issues] == [("fillers", 1.0), ("pace", 1.0)]


def test_seeded_sample_rates_are_shares(db: DB) -> None:
    seed(db, datetime(2026, 11, 14).date())
    issues = compute_profile(load_sessions(db)).recurring_issues
    assert issues and all(0.0 < i.rate <= 1.0 for i in issues)
