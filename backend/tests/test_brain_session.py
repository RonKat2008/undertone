"""Brain.start_session: which coach a session uses and which nudge policy it starts with."""

from __future__ import annotations

import dataclasses
from collections.abc import AsyncIterator
from pathlib import Path

import pytest

from backend import config, studio
from backend.brain import Brain
from backend.bus import Bus
from backend.contracts import CrutchWord, HabitProfile, RecurringIssue
from backend.db import DB
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
