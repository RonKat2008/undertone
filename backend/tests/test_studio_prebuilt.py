"""Prebuilt coach score thresholds match their questions' 1-based levels (1 = worst level)."""

from __future__ import annotations

import pytest

from backend import studio
from backend.contracts import CoachSpec, ScoreAnswer
from backend.nudge import evaluate_condition


def _coach(coach_id: str) -> CoachSpec:
    return next(c for c in studio.load_prebuilt() if c.id == coach_id)


def _rule_when(coach: CoachSpec, rule_id: str) -> str:
    return next(r.when for r in coach.nudge_rules if r.id == rule_id)


def _fires(when: str, qid: str, level: float, levels: int) -> bool:
    env = {"judge": {qid: ScoreAnswer(score=level, max=levels, confidence=0.9).model_dump()}}
    return evaluate_condition(when, env)


@pytest.mark.parametrize("coach_id", ["interview", "listener"])
def test_prebuilt_coaches_validate(coach_id: str) -> None:
    assert studio.validate_coach(_coach(coach_id)) == []


@pytest.mark.parametrize(("coach_id", "rule_id", "qid", "firing_levels"), [
    # no answer / answer at the very end / answer in the middle -> "Lead with the answer"
    ("interview", "bury_the_answer", "bottom_line_first", {1, 2, 3}),
    # ignores them / generic "cool" -> "Reflect back first"
    ("listener", "no_acknowledgement", "listening_depth", {1, 2}),
])
def test_score_rules_fire_on_the_levels_their_message_is_about(
        coach_id: str, rule_id: str, qid: str, firing_levels: set[int]) -> None:
    coach = _coach(coach_id)
    levels = len(coach.questions[qid].criteria)  # type: ignore[union-attr]
    when = _rule_when(coach, rule_id)
    fired = {lvl for lvl in range(1, levels + 1) if _fires(when, qid, float(lvl), levels)}
    assert fired == firing_levels
