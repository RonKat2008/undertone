"""validate_coach: the built-in coaches pass, and each rule rejects a bad spec (pure, no app)."""

from __future__ import annotations

from typing import Any

import pytest

from backend.contracts import ChoiceQuestion, CoachSpec, NoulQuestion, NudgeRule, ScoreQuestion
from backend.studio import default_coach, load_prebuilt, validate_coach


def _base() -> CoachSpec:
    return default_coach()


def _with(**update: Any) -> CoachSpec:
    return _base().model_copy(update=update)


def _rule(when: str = "metrics.wpm > 190", **kw: Any) -> NudgeRule:
    fields: dict[str, Any] = {"id": "extra", "when": when, "haptic": "tap", "message": "Slow down",
                              "cooldown_s": 30, "enabled": True}
    return NudgeRule(**{**fields, **kw})


def _with_rule(rule: NudgeRule) -> CoachSpec:
    base = _base()
    return base.model_copy(update={"nudge_rules": [*base.nudge_rules, rule]})


def _with_question(qid: str, q: Any) -> CoachSpec:
    base = _base()
    return base.model_copy(update={"questions": {**base.questions, qid: q}})


def _policy(**update: Any) -> CoachSpec:
    base = _base()
    return base.model_copy(update={"nudge_policy": base.nudge_policy.model_copy(update=update)})


def _has(errors: list[str], *needles: str) -> bool:
    return any(all(n in e for n in needles) for e in errors)


# ---------- valid coaches ----------

def test_default_coach_is_valid() -> None:
    assert validate_coach(default_coach()) == []


def test_prebuilt_coaches_are_valid() -> None:
    prebuilt = load_prebuilt()
    assert sorted(c.id for c in prebuilt) == ["interview", "listener"]
    for coach in prebuilt:
        assert validate_coach(coach) == [], coach.id


def test_question_defined_in_coach_can_be_referenced() -> None:
    spec = _with_question("eye_contact", NoulQuestion(instructions="Did the wearer look up?"))
    spec = spec.model_copy(update={"nudge_rules": [*spec.nudge_rules, _rule("judge.eye_contact.p >= 0.7")]})
    assert validate_coach(spec) == []


def test_core_choice_probability_accepted() -> None:
    assert validate_coach(_with_rule(_rule("judge.tone.probabilities.nervous >= 0.7"))) == []


def test_motion_fidget_while_other_accepted() -> None:
    assert validate_coach(_with_rule(_rule("motion.fidget_while_other_s > 5"))) == []


def test_validation_does_not_mutate_default() -> None:
    _with_rule(_rule("nonsense"))
    assert validate_coach(default_coach()) == []


# ---------- questions ----------

def test_bad_question_key() -> None:
    errs = validate_coach(_with_question("bad key!", NoulQuestion(instructions="x")))
    assert _has(errs, "question key", "bad key!")


def test_choice_with_one_option() -> None:
    errs = validate_coach(_with_question("pick", ChoiceQuestion(instructions="x", criteria={"a": "A"})))
    assert _has(errs, "pick", "2-255 options")


def test_score_with_one_level() -> None:
    errs = validate_coach(_with_question("lvl", ScoreQuestion(instructions="x", criteria=["only"])))
    assert _has(errs, "lvl", "at least 2")


def test_empty_instructions() -> None:
    errs = validate_coach(_with_question("blank", NoulQuestion(instructions="   ")))
    assert _has(errs, "blank", "instructions are empty")


# ---------- conditions ----------

@pytest.mark.parametrize(("when", "needle"), [
    ("talk ratio is high", "cannot parse"),
    ("judge.tone.choice == 'nervous'", "cannot parse"),
    ("judge.not_a_question.p >= 0.8", "not a core question"),
    ("judge.clarity.p >= 0.5", "only valid for yes/no"),
    ("judge.interrupted.score >= 2", "only valid for score"),
    ("judge.clarity.score >= 6", "1-5"),
    ("judge.clarity.score < 0", "1-5"),
    ("judge.tone.probabilities.furious >= 0.5", "not one of"),
    ("judge.interrupted.probabilities.yes >= 0.5", "only valid for choice"),
    ("metrics.charisma > 3", "unknown metric"),
    ("metrics.talk_ratio > 1.5", "within 0-1"),
    ("motion.fidget_while_listening_s > 5", "use motion.fidget_while_other_s"),
    ("posture.slouch > 1", "must start with judge., metrics. or motion."),
])
def test_bad_condition(when: str, needle: str) -> None:
    errs = validate_coach(_with_rule(_rule(when)))
    assert _has(errs, "'extra'", needle), errs


# ---------- rule fields ----------

@pytest.mark.parametrize("haptic", ["approve", "status_good"])
def test_disallowed_haptic(haptic: str) -> None:
    errs = validate_coach(_with_rule(_rule(haptic=haptic)))
    assert _has(errs, "haptic", haptic, "not allowed")


def test_empty_message() -> None:
    assert _has(validate_coach(_with_rule(_rule(message="  "))), "message is empty")


def test_overlong_message() -> None:
    assert _has(validate_coach(_with_rule(_rule(message="x" * 49))), "49 chars")


def test_duplicate_rule_ids() -> None:
    errs = validate_coach(_with_rule(_rule(id="interrupt")))
    assert _has(errs, "unique", "interrupt")


def test_empty_nudge_rules() -> None:
    base = _base()
    errs = validate_coach(base.model_copy(update={
        "nudge_rules": [], "motion_rules": [], "nudge_policy": base.nudge_policy}))
    assert _has(errs, "nudge_rules is empty")


# ---------- policy and thresholds ----------

def test_focus_rule_unknown() -> None:
    assert _has(validate_coach(_policy(focus_rule_id="nope")), "focus_rule_id", "not a rule id")


def test_focus_on_disabled_rule() -> None:
    base = _base()
    rules = [r.model_copy(update={"enabled": False}) if r.id == "interrupt" else r
             for r in base.nudge_rules]
    errs = validate_coach(base.model_copy(update={"nudge_rules": rules}))
    assert _has(errs, "focus_rule_id", "disabled")


@pytest.mark.parametrize("threshold", [0.3, 1.0])
def test_confidence_threshold_out_of_range(threshold: float) -> None:
    assert _has(validate_coach(_with(confidence_threshold=threshold)), "confidence_threshold")


def test_budget_zero() -> None:
    assert _has(validate_coach(_policy(budget_per_session=0)), "budget_per_session")


def test_tolerance_two() -> None:
    assert _has(validate_coach(_policy(tolerance=2)), "tolerance")
