"""Streak: practice days, one freeze repairs a single missed day, never any 'broken' wording."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from backend.contracts import DebriefNumbers, Streak
from backend.db import DB
from backend.growth._streak import compute_streak, streak_for
from backend.growth._writer import SessionSpec, write_session

TODAY = date(2026, 11, 14)
BANNED = ("broken", "broke", "lost", "failed", "fail")


def ago(n: int) -> date:
    return TODAY - timedelta(days=n)


def assert_kind(streak: Streak) -> None:
    text = streak.model_dump_json().lower()
    assert not any(word in text for word in BANNED)


def test_no_sessions_is_empty_streak() -> None:
    s = compute_streak([], TODAY)
    assert s == Streak(days=0, freeze_available=True, week=[False] * 7)


def test_consecutive_days_including_today() -> None:
    s = compute_streak([ago(0), ago(1), ago(2)], TODAY)
    assert s.days == 3
    assert s.freeze_available is True
    assert_kind(s)


def test_duplicate_days_count_once() -> None:
    s = compute_streak([ago(0), ago(0), ago(1)], TODAY)
    assert s.days == 2


def test_today_not_yet_practised_counts_from_yesterday() -> None:
    s = compute_streak([ago(1), ago(2), ago(3)], TODAY)
    assert s.days == 3
    assert s.freeze_available is True
    assert s.week[-1] is False


def test_single_gap_is_repaired_by_the_freeze() -> None:
    s = compute_streak([ago(0), ago(1), ago(3), ago(4)], TODAY)
    assert s.days == 4  # repaired day bridges the run but is not itself counted
    assert s.freeze_available is False
    assert_kind(s)


def test_missed_yesterday_repaired_when_today_not_yet_practised() -> None:
    s = compute_streak([ago(2), ago(3)], TODAY)
    assert s.days == 2
    assert s.freeze_available is False


def test_second_gap_ends_the_count() -> None:
    s = compute_streak([ago(0), ago(2), ago(4), ago(5)], TODAY)
    assert s.days == 2  # today + ago(2), freeze spent on ago(1); ago(3) ends the run
    assert s.freeze_available is False
    assert_kind(s)


def test_two_day_gap_is_not_repaired() -> None:
    s = compute_streak([ago(0), ago(3), ago(4)], TODAY)
    assert s.days == 1
    assert s.freeze_available is True


def test_freeze_does_not_bridge_into_nothing() -> None:
    s = compute_streak([ago(0)], TODAY)
    assert s.days == 1
    assert s.freeze_available is True


def test_old_practice_only_gives_zero_days_with_freeze_kept() -> None:
    s = compute_streak([ago(5), ago(6)], TODAY)
    assert s.days == 0
    assert s.freeze_available is True
    assert_kind(s)


def test_future_days_are_ignored() -> None:
    s = compute_streak([TODAY + timedelta(days=1), ago(0)], TODAY)
    assert s.days == 1


def test_week_booleans_oldest_first_last_is_today() -> None:
    s = compute_streak([ago(0), ago(2), ago(6), ago(9)], TODAY)
    assert s.week == [True, False, False, False, True, False, True]
    assert len(s.week) == 7


def test_streak_for_reads_finished_sessions(tmp_path: Path) -> None:
    db = DB(tmp_path / "t.db")
    nums = DebriefNumbers(talk_ratio=0.5, interruptions=1, questions=2, fillers_per_min=3.0, wpm=150)
    for i, n in enumerate((0, 1, 1, 3)):
        when = datetime.combine(ago(n), datetime.min.time(), timezone.utc) + timedelta(hours=10 + i)
        write_session(db, SessionSpec(session_id=f"s{i}", started_at=when, numbers=nums))
    db.create_session("open", "listener", "Listener", "regular", datetime.now(timezone.utc).isoformat())
    s = streak_for(db, TODAY)
    assert s.days == 3
    assert s.freeze_available is False
    assert s.week[-1] is True
    assert_kind(s)
