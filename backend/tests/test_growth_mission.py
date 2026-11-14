"""Tests for backend/growth/_mission.py: the daily mission, its progress and the wearer's choice."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import pytest

from backend.contracts import DailyMission, DebriefNumbers, HabitProfile, RecurringIssue
from backend.db import DB
from backend.growth._mission import (
    apply_progress,
    build_mission,
    choose_mission,
    choose_today,
    mission_kind,
    mission_today,
)
from backend.growth._profile import compute_profile
from backend.growth._store import load_sessions
from backend.growth._writer import SessionSpec, write_session

TODAY = date(2026, 11, 14)


@pytest.fixture
def db(tmp_path: Path) -> Iterator[DB]:
    database = DB(tmp_path / "t.db")
    yield database
    database.close()


def nums(fillers: float = 2.0, talk: float = 0.5, interruptions: int = 0, questions: int = 2,
         wpm: float = 140.0) -> DebriefNumbers:
    return DebriefNumbers(talk_ratio=talk, interruptions=interruptions, questions=questions,
                          fillers_per_min=fillers, wpm=wpm)


def add(db: DB, sid: str, day: date, hour: int = 10, **kw: object) -> None:
    started = datetime.combine(day, time(hour), tzinfo=timezone.utc)
    numbers = kw.pop("numbers", nums())
    write_session(db, SessionSpec(session_id=sid, started_at=started, numbers=numbers,  # type: ignore[arg-type]
                                  **kw))  # type: ignore[arg-type]


def days_ago(n: int) -> date:
    return TODAY - timedelta(days=n)


def five_filler_sessions(db: DB) -> None:
    """Older days ~9 fillers/min; yesterday two sessions at 7.0 and 8.0 (mean 7.5)."""
    texts = ("um so like it was, um, fine",)
    add(db, "a", days_ago(4), numbers=nums(fillers=9.0), wearer_texts=texts)
    add(db, "b", days_ago(3), numbers=nums(fillers=9.5), wearer_texts=texts)
    add(db, "c", days_ago(2), numbers=nums(fillers=8.5), wearer_texts=texts)
    add(db, "d", days_ago(1), 9, numbers=nums(fillers=7.0), wearer_texts=texts)
    add(db, "e", days_ago(1), 15, numbers=nums(fillers=8.0), wearer_texts=texts)


def state(db: DB) -> tuple[list, HabitProfile]:  # type: ignore[type-arg]
    sessions = load_sessions(db)
    return sessions, compute_profile(sessions)


def assert_plan_shape(m: DailyMission) -> None:
    assert m.if_then.startswith(("When", "If"))
    assert 2 <= len(m.suggestions) <= 3
    assert m.focus_rule_id not in {s.focus_rule_id for s in m.suggestions}
    assert m.progress == 0 and m.done is False


# ---------- build_mission ----------
def test_starter_mission_with_no_sessions() -> None:
    m = build_mission([], HabitProfile(), TODAY)
    assert m.date == TODAY.isoformat()
    assert m.focus_rule_id == "questions"
    assert m.target == 1
    assert m.text.startswith("Try")
    assert mission_kind(m) == "learning"
    assert_plan_shape(m)


def test_one_session_gives_a_learning_goal(db: DB) -> None:
    add(db, "a", days_ago(1), numbers=nums(fillers=7.5), wearer_texts=("um, um, so like that",))
    sessions, profile = state(db)
    m = build_mission(sessions, profile, TODAY)
    assert m.focus_rule_id == "fillers"
    assert m.target == 1
    assert m.text.startswith("Try") and m.text.endswith("in one conversation")
    assert "'um'" in m.if_then
    assert mission_kind(m) == "learning"
    assert_plan_shape(m)


def test_five_sessions_give_an_outcome_target_from_yesterday(db: DB) -> None:
    five_filler_sessions(db)
    sessions, profile = state(db)
    m = build_mission(sessions, profile, TODAY)
    assert m.focus_rule_id == "fillers"
    assert m.target == 6.4  # 7.5 improved by 15%
    assert 7.5 * 0.8 <= m.target < 7.5 * 0.9
    assert m.text == "Keep fillers under 6.4 a minute in one conversation"
    assert mission_kind(m) == "outcome"
    assert_plan_shape(m)


def test_todays_sessions_do_not_count_as_yesterday(db: DB) -> None:
    five_filler_sessions(db)
    add(db, "today", TODAY, numbers=nums(fillers=1.0))
    sessions, profile = state(db)
    assert build_mission(sessions, profile, TODAY).target == 6.4


def test_worst_recurring_issue_becomes_focus(db: DB) -> None:
    for i, sid in enumerate("abcd"):
        add(db, sid, days_ago(4 - i), numbers=nums(interruptions=3),
            nudges=(("interrupt", True), ("interrupt", False), ("pace", True)))
    sessions, profile = state(db)
    m = build_mission(sessions, profile, TODAY)
    assert m.focus_rule_id == "interrupt"
    assert m.target == 2
    assert m.text == "Keep interruptions to 2 or fewer in one conversation"
    assert "pace" in {s.focus_rule_id for s in m.suggestions}


def test_talk_share_target_reads_as_a_percent(db: DB) -> None:
    for i, sid in enumerate("abc"):
        add(db, sid, days_ago(3 - i), numbers=nums(talk=0.7))
    sessions, profile = state(db)
    m = build_mission(sessions, profile, TODAY, preferred="talk_share")
    assert m.focus_rule_id == "talk_share"
    assert m.target == 0.6  # 0.7 * 0.85 = 0.595
    assert "60%" in m.text


def test_questions_target_is_higher_by_at_least_one(db: DB) -> None:
    for i, sid in enumerate("abc"):
        add(db, sid, days_ago(3 - i), numbers=nums(questions=3))
    sessions, profile = state(db)
    m = build_mission(sessions, profile, TODAY, preferred="questions")
    assert m.target == 4
    assert m.text == "Ask at least 4 questions in one conversation"


def test_unknown_preferred_is_ignored() -> None:
    assert build_mission([], HabitProfile(), TODAY, preferred="nonsense").focus_rule_id == "questions"


def test_unknown_rule_from_profile_gets_generic_habit(db: DB) -> None:
    profile = HabitProfile(sessions=1, recurring_issues=[
        RecurringIssue(rule_id="mumbling_softly", label="Mumbling softly", rate=2.0, trend="worse")])
    m = build_mission([], profile, TODAY)
    assert m.focus_rule_id == "mumbling_softly"
    assert "mumbling softly" in m.if_then.lower()


# ---------- apply_progress ----------
def test_apply_progress_learning(db: DB) -> None:
    m = build_mission([], HabitProfile(), TODAY)
    assert apply_progress(m, []).done is False
    add(db, "t", TODAY)
    done = apply_progress(m, load_sessions(db))
    assert done.progress == 1 and done.done is True
    assert m.progress == 0  # original untouched


def test_apply_progress_outcome(db: DB) -> None:
    five_filler_sessions(db)
    sessions, profile = state(db)
    m = build_mission(sessions, profile, TODAY)
    add(db, "t1", TODAY, 9, numbers=nums(fillers=7.0))
    first = apply_progress(m, [s for s in load_sessions(db) if s.day == TODAY])
    assert first.progress == 7.0 and first.done is False
    add(db, "t2", TODAY, 12, numbers=nums(fillers=6.0))
    second = apply_progress(m, [s for s in load_sessions(db) if s.day == TODAY])
    assert second.progress == 6.0 and second.done is True


# ---------- choose_mission ----------
def test_choose_suggestion_switches_focus_and_target(db: DB) -> None:
    five_filler_sessions(db)
    sessions, profile = state(db)
    m = build_mission(sessions, profile, TODAY)
    pick = m.suggestions[0].focus_rule_id
    chosen = choose_mission(m, pick, sessions, profile, TODAY)
    assert chosen.focus_rule_id == pick
    assert chosen.if_then != m.if_then
    assert "fillers" in {s.focus_rule_id for s in chosen.suggestions}
    assert choose_mission(m, "fillers", sessions, profile, TODAY) == m


def test_choose_invalid_raises(db: DB) -> None:
    m = build_mission([], HabitProfile(), TODAY)
    with pytest.raises(ValueError):
        choose_mission(m, "not_a_suggestion", [], HabitProfile(), TODAY)


# ---------- DB wrappers ----------
def test_mission_today_is_stable_within_a_day(db: DB) -> None:
    five_filler_sessions(db)
    first = mission_today(db, TODAY)
    add(db, "t1", TODAY, 9, numbers=nums(fillers=5.0, interruptions=9),
        nudges=(("interrupt", True),) * 9)
    second = mission_today(db, TODAY)
    assert (second.focus_rule_id, second.text, second.target) == (first.focus_rule_id, first.text, first.target)
    assert second.progress == 5.0 and second.done is True
    assert db.load_mission(TODAY.isoformat()) == second


def test_choose_today_persists_and_carries_into_tomorrow(db: DB) -> None:
    five_filler_sessions(db)
    m = mission_today(db, TODAY)
    pick = m.suggestions[0].focus_rule_id
    chosen = choose_today(db, pick, TODAY)
    assert chosen.focus_rule_id == pick
    assert db.load_mission(TODAY.isoformat()) == chosen
    assert mission_today(db, TODAY).focus_rule_id == pick
    assert mission_today(db, TODAY + timedelta(days=1)).focus_rule_id == pick


def test_choose_today_invalid_raises_and_keeps_mission(db: DB) -> None:
    m = mission_today(db, TODAY)
    with pytest.raises(ValueError):
        choose_today(db, "bogus", TODAY)
    assert db.load_mission(TODAY.isoformat()) == m
