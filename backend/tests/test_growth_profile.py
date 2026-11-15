"""Tests for backend/growth/_profile.py: filler counting and the habit profile maths."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from backend.contracts import DebriefNumbers
from backend.db import DB
from backend.growth._profile import BUILTIN_FILLERS, compute_profile, count_fillers, rebuild_profile
from backend.growth._store import load_sessions
from backend.growth._writer import SessionSpec, write_session

BASE = datetime(2026, 11, 10, 15, 0, tzinfo=timezone.utc)


@pytest.fixture
def db(tmp_path: Path) -> Iterator[DB]:
    database = DB(tmp_path / "t.db")
    yield database
    database.close()


def nums(wpm: float = 140.0, fillers: float = 2.0) -> DebriefNumbers:
    return DebriefNumbers(talk_ratio=0.5, interruptions=0, questions=2, fillers_per_min=fillers, wpm=wpm)


def add(db: DB, i: int, **kw: object) -> None:
    started = kw.pop("started_at", BASE + timedelta(hours=i))
    numbers = kw.pop("numbers", nums())
    write_session(db, SessionSpec(session_id=f"s{i}", started_at=started, numbers=numbers,  # type: ignore[arg-type]
                                  **kw))  # type: ignore[arg-type]


# ---------- count_fillers ----------
def test_builtin_fillers_include_core_words() -> None:
    for word in ("like", "um", "uh", "basically", "you know", "sort of", "kind of", "i mean", "actually"):
        assert word in BUILTIN_FILLERS


def test_count_fillers_skips_like_as_verb_or_comparison() -> None:
    text = ("Um, I like pizza, like, you know, it looks like rain. I'd like that. "
            "Like, basically we would like to go. It sounds like fun and I feel like it.")
    counts = count_fillers(text, BUILTIN_FILLERS)
    assert counts["like"] == 2
    assert counts["um"] == 1
    assert counts["you know"] == 1
    assert counts["basically"] == 1


def test_count_fillers_is_case_insensitive_with_word_boundaries() -> None:
    counts = count_fillers("UM umbrella, Um. Literally likely unlike", ["um", "literally", "like"])
    assert counts == {"um": 2, "literally": 1}


def test_count_fillers_matches_longest_phrase_first() -> None:
    counts = count_fillers("You know, I know it. At the end of the day, you know.",
                           ["you know", "know", "at the end of the day", "day"])
    assert counts == {"you know": 2, "know": 1, "at the end of the day": 1}


def test_count_fillers_skips_kind_of_as_a_noun_phrase() -> None:
    counts = count_fillers("It was kind of weird, a kind of thing, what kind of car", BUILTIN_FILLERS)
    assert counts == {"kind of": 1}


def test_count_fillers_empty_inputs() -> None:
    assert count_fillers("", BUILTIN_FILLERS) == {}
    assert count_fillers("um like", []) == {}


# ---------- compute_profile ----------
def test_profile_with_no_sessions_is_empty() -> None:
    profile = compute_profile([])
    assert profile.sessions == 0
    assert profile.baseline_wpm is None
    assert profile.baseline_volume_db is None
    assert profile.crutch_words == []
    assert profile.recurring_issues == []


def test_profile_median_baselines_ignore_zeros(db: DB) -> None:
    add(db, 1, numbers=nums(wpm=120.0), volume_db=-20.0)
    add(db, 2, numbers=nums(wpm=140.0), volume_db=-30.0)
    add(db, 3, numbers=nums(wpm=0.0), volume_db=0.0)
    add(db, 4, numbers=nums(wpm=200.0), volume_db=-25.0)
    profile = compute_profile(load_sessions(db))
    assert profile.sessions == 4
    assert profile.baseline_wpm == 140.0
    assert profile.baseline_volume_db == -25.0


def test_profile_crutch_words_per_minute_of_wearer_speech(db: DB) -> None:
    add(db, 1, wearer_texts=("um so like, I like it", "you know, um"))
    add(db, 2, wearer_texts=("it looks like rain, um", "honestly right"), duration_s=300.0)
    sessions = load_sessions(db)
    minutes = sum(s.minutes for s in sessions)
    profile = compute_profile(sessions, filler_words=["right"])
    by_word = {c.word: c.per_min for c in profile.crutch_words}
    assert by_word["um"] == round(3 / minutes, 2)
    assert by_word["like"] == round(1 / minutes, 2)
    assert by_word["right"] == round(1 / minutes, 2)
    assert profile.crutch_words[0].word == "um"
    assert len(profile.crutch_words) == 5
    assert all(c.per_min > 0 for c in profile.crutch_words)


def test_profile_recurring_issue_rates_and_trends(db: DB) -> None:
    # s1..s3 are the oldest, s4..s6 the newest.
    for i in range(1, 7):
        newest = i >= 4
        nudges: list[tuple[str, bool]] = [("interrupt", True)] * (1 if newest else 3)
        nudges += [("hedging", i % 2 == 0)] * (2 if newest else 0)
        nudges += [("long_turn", False)]
        add(db, i, nudges=tuple(nudges))
    profile = compute_profile(load_sessions(db))
    issues = {r.rule_id: r for r in profile.recurring_issues}
    # rate = share of sessions where the rule fired at least once (0..1), not fires per session
    assert issues["interrupt"].rate == 1.0
    assert issues["interrupt"].trend == "better"
    assert issues["interrupt"].label == "Interrupting"
    assert issues["hedging"].rate == 0.5
    assert issues["hedging"].trend == "worse"
    assert issues["long_turn"].rate == 1.0
    assert issues["long_turn"].trend == "same"
    assert profile.recurring_issues[0].rule_id == "interrupt"  # ties with long_turn on share; fires more


def test_profile_trend_is_same_with_one_session(db: DB) -> None:
    add(db, 1, nudges=(("interrupt", True), ("interrupt", True)))
    profile = compute_profile(load_sessions(db))
    assert profile.recurring_issues[0].trend == "same"
    assert profile.recurring_issues[0].rate == 1.0


def test_rebuild_profile_saves_and_uses_db(db: DB) -> None:
    add(db, 1, wearer_texts=("um um basically",), nudges=(("pace", True),))
    profile = rebuild_profile(db)
    assert profile.sessions == 1
    assert db.load_profile() == profile
    assert {c.word for c in profile.crutch_words} == {"um", "basically"}
