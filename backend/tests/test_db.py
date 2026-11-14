"""Tests for backend/db.py: SQLite storage."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import pytest

from backend.contracts import (
    BookmarkEvent, CoachSpec, DailyMission, Debrief, HabitProfile, JudgeEvent, Metrics,
    NudgeEvent, Person, SessionSummary, TurnFinalEvent,
)
from backend.db import DB

NUMBERS = {"talk_ratio": 0.6, "interruptions": 2, "questions": 3, "fillers_per_min": 1.5, "wpm": 150.0}
EXPECTED_TABLES = {
    "sessions", "turns", "judge_results", "nudges", "bookmarks", "debriefs", "coaches",
    "profile", "missions", "people", "kv",
}


@pytest.fixture
def db(tmp_path: Path) -> Iterator[DB]:
    database = DB(tmp_path / "t.db")
    yield database
    database.close()


def turn(turn_id: str, start: float, speaker: str = "me") -> TurnFinalEvent:
    return TurnFinalEvent(turn_id=turn_id, speaker=speaker, text=f"text {turn_id}", start=start,
                          end=start + 2, wpm=140, fillers=["um"])


def coach(coach_id: str, name: str = "Coach") -> CoachSpec:
    return CoachSpec.model_validate({
        "id": coach_id, "name": name, "goal": "Listen more", "kind": "custom",
        "confidence_threshold": 0.75,
        "questions": {
            "interrupted": {"type": "noul", "instructions": "Cut off?"},
            "tone": {"type": "choice", "instructions": "Tone?", "criteria": {"warm": "kind"}},
            "clarity": {"type": "score", "instructions": "Clear?", "criteria": ["one point"]},
        },
        "nudge_rules": [{"id": "interrupt", "when": "judge.interrupted.p >= 0.8",
                         "haptic": "interrupt", "message": "Let them finish", "cooldown_s": 30}],
        "nudge_policy": {"focus_rule_id": "interrupt"},
        "drill": {"partner_persona": "busy manager", "prompts": ["Hi"]},
    })


def table_names(db: DB) -> set[str]:
    rows = db.query("SELECT name FROM sqlite_master WHERE type = 'table'")
    return {r["name"] for r in rows}


def test_schema_creates_all_tables(db: DB) -> None:
    assert EXPECTED_TABLES <= table_names(db)


def test_reopen_existing_db_is_idempotent(tmp_path: Path) -> None:
    path = tmp_path / "t.db"
    first = DB(path)
    first.kv_set("k", 1)
    first.close()
    second = DB(path)
    assert second.kv_get("k") == 1
    second.close()


# ---- sessions ----
def test_create_get_end_list_sessions(db: DB) -> None:
    db.create_session("s-1", "listener", "Better Listener", "regular", "2026-11-14T09:00:00Z")
    db.create_session("s-2", "listener", "Better Listener", "practice", "2026-11-14T10:00:00Z")

    row = db.get_session("s-1")
    assert row is not None
    assert row["coach_id"] == "listener"
    assert row["mode"] == "regular"
    assert row["ended_at"] is None
    assert row["metrics_json"] is None

    metrics = Metrics(talk_ratio=0.6, wpm=150, baseline_wpm=140)
    summary = SessionSummary(session_id="s-1", started_at="2026-11-14T09:00:00Z", duration_s=600,
                             coach_name="Better Listener", mode="regular", headline_fact="62%",
                             numbers=NUMBERS)
    db.end_session("s-1", "2026-11-14T09:10:00Z", 600.0, metrics, summary)

    row = db.get_session("s-1")
    assert row is not None
    assert row["ended_at"] == "2026-11-14T09:10:00Z"
    assert row["duration_s"] == 600.0
    assert Metrics.model_validate_json(row["metrics_json"]) == metrics
    assert SessionSummary.model_validate_json(row["summary_json"]) == summary

    listed = db.list_sessions()
    assert [r["session_id"] for r in listed] == ["s-2", "s-1"]  # newest first
    assert [r["session_id"] for r in db.list_sessions(limit=1)] == ["s-2"]


def test_end_session_without_summary(db: DB) -> None:
    db.create_session("s-1", "c", "C", "regular", "2026-11-14T09:00:00Z")
    db.end_session("s-1", "2026-11-14T09:01:00Z", 60.0, Metrics(), None)
    row = db.get_session("s-1")
    assert row is not None
    assert row["summary_json"] is None


def test_set_session_person(db: DB) -> None:
    db.create_session("s-1", "c", "C", "regular", "2026-11-14T09:00:00Z")
    db.set_session_person("s-1", "p-sam")
    assert db.get_session("s-1")["person_id"] == "p-sam"  # type: ignore[index]


def test_get_missing_session_returns_none(db: DB) -> None:
    assert db.get_session("nope") is None
    assert db.list_sessions() == []


# ---- per-session records ----
def test_turns_round_trip_ordered_by_start(db: DB) -> None:
    db.save_turn("s-1", turn("t-2", 10.0, "other"))
    db.save_turn("s-1", turn("t-1", 1.0))
    db.save_turn("s-2", turn("t-9", 5.0))
    loaded = db.load_turns("s-1")
    assert [t.turn_id for t in loaded] == ["t-1", "t-2"]
    assert loaded[0] == turn("t-1", 1.0)


def test_save_turn_same_id_replaces(db: DB) -> None:
    db.save_turn("s-1", turn("t-1", 1.0))
    updated = turn("t-1", 1.0).model_copy(update={"text": "edited"})
    db.save_turn("s-1", updated)
    assert db.load_turns("s-1") == [updated]


def test_judges_round_trip(db: DB) -> None:
    judge = JudgeEvent.model_validate({
        "turn_id": "t-1", "latency_ms": 120, "source": "rules",
        "results": {
            "interrupted": {"kind": "noul", "p": 0.9, "confidence": 0.9},
            "tone": {"kind": "choice", "choice": "warm", "probabilities": {"warm": 0.8},
                     "confidence": 0.8},
            "clarity": {"kind": "score", "score": 4, "max": 5, "confidence": 0.5},
        },
    })
    db.save_judge("s-1", judge)
    assert db.load_judges("s-1") == [judge]
    assert db.load_judges("s-2") == []


def test_nudges_round_trip_ordered_by_ts(db: DB) -> None:
    def nudge(ts: float) -> NudgeEvent:
        return NudgeEvent(rule_id="interrupt", haptic="interrupt", message="Let them finish",
                          reason="p=0.9", confidence=0.9, latency_ms=100, budget_left=4, ts=ts)

    db.save_nudge("s-1", nudge(30.0))
    db.save_nudge("s-1", nudge(10.0))
    assert [n.ts for n in db.load_nudges("s-1")] == [10.0, 30.0]


def test_bookmarks_round_trip(db: DB) -> None:
    first = BookmarkEvent(source="promise", text="send the deck", ts=50.0)
    second = BookmarkEvent(source="phone", text=None, ts=20.0)
    db.save_bookmark("s-1", first)
    db.save_bookmark("s-1", second)
    assert db.load_bookmarks("s-1") == [second, first]


def test_debrief_round_trip(db: DB) -> None:
    debrief = Debrief.model_validate({
        "headline_fact": "62%", "strength": "Good summary", "one_fix": "Interrupting",
        "if_then": "When they pause, count to two", "numbers": NUMBERS,
        "best_moment_quote": "What would make this a win?", "vs_last_time": None,
        "notes": ["roadmap"],
        "bookmarks": [{"ts": 1, "source": "phone", "snippet": "s", "what_happened": "w",
                       "follow_up": "f"}],
        "timeline": [{"t": 0, "wpm": 140, "volume_db": -20, "hand_energy": 0.5}],
        "better_version": {"original": "um so", "rewritten": "So", "audio_url": None},
    })
    assert db.load_debrief("s-1") is None
    db.save_debrief("s-1", debrief, "https://example.com/a.mp3")
    assert db.load_debrief("s-1") == (debrief, "https://example.com/a.mp3")
    db.save_debrief("s-1", debrief, None)
    assert db.load_debrief("s-1") == (debrief, None)


# ---- coaches ----
def test_coach_save_load_list(db: DB) -> None:
    assert db.load_coach("b") is None
    db.save_coach(coach("b", "Bravo"))
    db.save_coach(coach("a", "Alpha"))
    assert db.load_coach("b") == coach("b", "Bravo")
    assert [c.id for c in db.list_coaches()] == ["a", "b"]

    db.save_coach(coach("b", "Bravo v2"))
    assert db.load_coach("b").name == "Bravo v2"  # type: ignore[union-attr]
    assert len(db.list_coaches()) == 2


# ---- profile / missions / people ----
def test_profile_round_trip(db: DB) -> None:
    assert db.load_profile() is None
    profile = HabitProfile.model_validate({
        "sessions": 3, "baseline_wpm": 150, "baseline_volume_db": -22,
        "crutch_words": [{"word": "um", "per_min": 2}],
        "recurring_issues": [{"rule_id": "interrupt", "label": "Interrupting", "rate": 0.3,
                              "trend": "same"}],
    })
    db.save_profile(profile)
    assert db.load_profile() == profile
    db.save_profile(HabitProfile(sessions=4))
    assert db.load_profile() == HabitProfile(sessions=4)


def test_mission_round_trip(db: DB) -> None:
    mission = DailyMission.model_validate({
        "date": "2026-11-14", "focus_rule_id": "questions", "text": "Ask 3 questions",
        "if_then": "After a story, ask", "target": 3, "progress": 1, "done": False,
        "suggestions": [{"focus_rule_id": "filler", "text": "Pause"}],
    })
    assert db.load_mission("2026-11-14") is None
    db.save_mission(mission)
    assert db.load_mission("2026-11-14") == mission
    assert db.load_mission("2026-11-15") is None


def test_people_round_trip_ordered_by_name(db: DB) -> None:
    sam = Person(person_id="p-sam", name="Sam", sessions=2, pattern="p", brief="b")
    alex = Person(person_id="p-alex", name="Alex")
    db.save_person(sam)
    db.save_person(alex)
    assert db.list_people() == [alex, sam]
    db.save_person(sam.model_copy(update={"sessions": 3}))
    assert [p.sessions for p in db.list_people()] == [0, 3]


# ---- kv ----
def test_kv_set_get(db: DB) -> None:
    assert db.kv_get("missing") is None
    assert db.kv_get("missing", "fallback") == "fallback"
    db.kv_set("active_coach", "listener")
    db.kv_set("config", {"a": [1, 2], "b": None})
    assert db.kv_get("active_coach") == "listener"
    assert db.kv_get("config") == {"a": [1, 2], "b": None}
    db.kv_set("active_coach", "presenter")
    assert db.kv_get("active_coach") == "presenter"


# ---- injection safety ----
INJECTION = "x'); DROP TABLE turns;--"


def test_injection_shaped_strings_stored_literally(db: DB) -> None:
    db.create_session(INJECTION, INJECTION, INJECTION, "regular", "2026-11-14T09:00:00Z")
    db.save_turn(INJECTION, turn(INJECTION, 1.0).model_copy(update={"text": INJECTION}))
    db.kv_set(INJECTION, INJECTION)
    db.save_person(Person(person_id=INJECTION, name=INJECTION))
    db.save_coach(coach(INJECTION, INJECTION))

    assert EXPECTED_TABLES <= table_names(db)
    row = db.get_session(INJECTION)
    assert row is not None
    assert row["coach_name"] == INJECTION
    turns = db.load_turns(INJECTION)
    assert [(t.turn_id, t.text) for t in turns] == [(INJECTION, INJECTION)]
    assert db.kv_get(INJECTION) == INJECTION
    assert db.list_people()[0].person_id == INJECTION
    assert db.load_coach(INJECTION).name == INJECTION  # type: ignore[union-attr]
    # Other data untouched and tables still usable.
    db.save_turn("s-ok", turn("t-ok", 0.0))
    assert len(db.load_turns("s-ok")) == 1
