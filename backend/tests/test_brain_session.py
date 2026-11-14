"""Brain.start_session: which coach a session uses and which nudge policy it starts with."""

from __future__ import annotations

import dataclasses
from collections.abc import AsyncIterator
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from backend import config, growth, studio
from backend.brain import DEMO_BUDGET, DEMO_MIN_GAP_S, Brain
from backend.bus import Bus
from backend.contracts import CoachSpec, CrutchWord, DebriefNumbers, HabitProfile, RecurringIssue
from backend.db import DB
from backend.growth._writer import SessionSpec, write_session
from backend.state import AppState


def _brain(db: DB, demo_policy: bool = False) -> Brain:
    settings = dataclasses.replace(config.settings, demo_policy=demo_policy)
    state = AppState(bus=Bus(), db=db, active_coach=studio.default_coach())
    return Brain(state, settings)


@pytest.fixture
async def db(tmp_path: Path) -> AsyncIterator[DB]:
    database = DB(tmp_path / "brain.db")
    yield database
    database.close()


async def _stop(brain: Brain) -> None:
    if brain._ticker is not None:  # no debrief needed; just stop the 1 Hz loop
        brain._ticker.cancel()
    brain.app.session = None


PROFILE = HabitProfile(
    sessions=4, baseline_wpm=150.0,
    crutch_words=[CrutchWord(word="basically", per_min=3.0), CrutchWord(word="like", per_min=1.0)],
    recurring_issues=[RecurringIssue(rule_id="interrupt", label="Interrupting", rate=2.0, trend="worse")],
)


async def test_practice_without_coach_uses_personal_coach_from_profile(db: DB) -> None:
    db.save_profile(PROFILE)
    brain = _brain(db)
    await brain.start_session(mode="practice")
    session = brain.app.session
    assert session is not None
    expected = studio.build_personal_coach(PROFILE)
    assert session.coach == expected
    assert session.coach.kind == "personal"
    assert session.coach.filler_words[:2] == ["basically", "like"]
    assert session.coach.id != brain.app.active_coach.id
    await _stop(brain)


async def test_practice_with_no_profile_uses_starter_personal_coach(db: DB) -> None:
    brain = _brain(db)
    await brain.start_session(mode="practice")
    assert brain.app.session is not None
    assert brain.app.session.coach.kind == "personal"
    await _stop(brain)


async def test_regular_without_coach_uses_active_coach(db: DB) -> None:
    db.save_profile(PROFILE)
    brain = _brain(db)
    await brain.start_session()
    assert brain.app.session is not None
    assert brain.app.session.coach.id == brain.app.active_coach.id
    await _stop(brain)


async def test_practice_with_explicit_coach_uses_that_coach(db: DB) -> None:
    brain = _brain(db)
    await brain.start_session("listener", mode="practice")
    assert brain.app.session is not None
    assert brain.app.session.coach.id == "listener"
    await _stop(brain)


# ---------- fading (plan.md 4.0 / 4.5) ----------
BASE = datetime(2026, 11, 10, 15, 0, tzinfo=timezone.utc)
NUMS = DebriefNumbers(talk_ratio=0.5, interruptions=0, questions=2, fillers_per_min=1.0, wpm=140.0)


def _history(db: DB, coach_id: str, rule_id: str, fires: list[int], start: int = 0) -> None:
    """Finished regular sessions oldest first, each with `fires[i]` focus fires (half quiet)."""
    for i, n in enumerate(fires, start=start):
        nudges = tuple((rule_id, k % 2 == 0) for k in range(n))
        write_session(db, SessionSpec(session_id=f"h{i}", started_at=BASE + timedelta(hours=i), numbers=NUMS,
                                      wearer_texts=("I think so.",) * 3, coach_id=coach_id, nudges=nudges))


def _listener(brain: Brain) -> CoachSpec:
    coach = brain.find_coach("listener")
    assert coach is not None
    return coach


async def test_improving_history_lowers_budget_by_one(db: DB) -> None:
    brain = _brain(db)
    coach = _listener(brain)
    _history(db, coach.id, coach.nudge_policy.focus_rule_id, [6, 4, 2])  # session 4 is next
    await brain.start_session(coach.id)
    assert brain.app.session is not None
    policy = brain.app.session.policy
    assert policy.budget_per_session == coach.nudge_policy.budget_per_session - 1
    assert policy.silent is False
    await _stop(brain)


async def test_flat_history_keeps_budget(db: DB) -> None:
    brain = _brain(db)
    coach = _listener(brain)
    _history(db, coach.id, coach.nudge_policy.focus_rule_id, [3, 3, 3])
    await brain.start_session(coach.id)
    assert brain.app.session is not None
    assert brain.app.session.policy == coach.nudge_policy
    await _stop(brain)


async def test_fifth_session_is_silent(db: DB) -> None:
    brain = _brain(db)
    coach = _listener(brain)
    _history(db, "interview", "hedging", [1, 1, 1, 1])  # any coach counts toward the session index
    await brain.start_session(coach.id)
    assert brain.app.session is not None
    assert brain.app.session.policy.silent is True
    assert brain.nudge is not None and brain.nudge.policy.silent is True
    await _stop(brain)


async def test_demo_policy_ignores_fading(db: DB) -> None:
    brain = _brain(db, demo_policy=True)
    coach = _listener(brain)
    _history(db, coach.id, coach.nudge_policy.focus_rule_id, [6, 4, 2, 1])  # improving, session 5 next
    await brain.start_session(coach.id)
    assert brain.app.session is not None
    policy = brain.app.session.policy
    assert policy.budget_per_session == DEMO_BUDGET and policy.min_gap_s == DEMO_MIN_GAP_S
    assert policy.silent is False
    await _stop(brain)


async def test_practice_mode_is_not_faded(db: DB) -> None:
    brain = _brain(db)
    _history(db, "personal", "filler", [1, 1, 1, 1])
    await brain.start_session(mode="practice")
    assert brain.app.session is not None
    assert brain.app.session.policy == brain.app.session.coach.nudge_policy
    await _stop(brain)


async def test_fading_failure_still_starts_session(db: DB, monkeypatch: pytest.MonkeyPatch) -> None:
    brain = _brain(db)
    coach = _listener(brain)

    def boom(*_: object) -> list[float]:
        raise RuntimeError("db gone")

    monkeypatch.setattr(growth, "focus_rates", boom)
    sid = await brain.start_session(coach.id)
    assert sid and brain.app.session is not None
    assert brain.app.session.policy == coach.nudge_policy
    await _stop(brain)


def test_focus_rates_oldest_to_newest_per_minute(db: DB) -> None:
    _history(db, "listener", "interrupt", [6, 4, 2])
    _history(db, "interview", "interrupt", [9], start=10)  # other coach: ignored
    rates = growth.focus_rates(db, "listener", "interrupt")
    assert len(rates) == 3 and rates[0] > rates[1] > rates[2] > 0
    assert growth.next_session_index(db) == 5
