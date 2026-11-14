"""Tests for the nudge fading policy."""

from backend.contracts import NudgePolicy
from backend.nudge.policy import next_policy


def _policy(**kw: object) -> NudgePolicy:
    return NudgePolicy(focus_rule_id="filler", **kw)


def test_improving_rates_drop_budget_by_one() -> None:
    out = next_policy(_policy(budget_per_session=5), [3.0, 2.0, 1.0], 2)
    assert out.budget_per_session == 4


def test_budget_never_below_one() -> None:
    out = next_policy(_policy(budget_per_session=1), [3.0, 2.0, 1.0], 2)
    assert out.budget_per_session == 1


def test_flat_rates_unchanged() -> None:
    assert next_policy(_policy(), [2.0, 2.0, 2.0], 2).budget_per_session == 5


def test_worsening_rates_unchanged() -> None:
    assert next_policy(_policy(), [1.0, 2.0, 3.0], 2).budget_per_session == 5


def test_fewer_than_three_rates_unchanged() -> None:
    assert next_policy(_policy(), [2.0, 1.0], 2).budget_per_session == 5
    assert next_policy(_policy(), [], 2).budget_per_session == 5


def test_only_last_three_considered() -> None:
    assert next_policy(_policy(), [1, 5, 4, 3], 2).budget_per_session == 4


def test_fifth_and_tenth_sessions_silent() -> None:
    assert next_policy(_policy(), [], 5).silent is True
    assert next_policy(_policy(), [], 10).silent is True


def test_other_sessions_not_silent() -> None:
    assert next_policy(_policy(), [], 4).silent is False
    assert next_policy(_policy(), [], 6).silent is False


def test_nonpositive_session_index_not_silent() -> None:
    assert next_policy(_policy(), [], 0).silent is False
    assert next_policy(_policy(), [], -5).silent is False


def test_silent_input_resets_on_non_fifth_session() -> None:
    assert next_policy(_policy(silent=True), [], 6).silent is False


def test_both_effects_apply_together() -> None:
    out = next_policy(_policy(budget_per_session=3), [3.0, 2.0, 1.0], 5)
    assert out.budget_per_session == 2
    assert out.silent is True


def test_input_not_mutated_and_new_instance_returned() -> None:
    policy = _policy(silent=True)
    before = policy.model_dump()
    out = next_policy(policy, [3.0, 2.0, 1.0], 6)
    assert policy.model_dump() == before
    assert out is not policy


def test_nan_treated_as_not_improved() -> None:
    nan = float("nan")
    assert next_policy(_policy(), [3.0, nan, 1.0], 2).budget_per_session == 5
    assert next_policy(_policy(), [nan, 2.0, 1.0], 2).budget_per_session == 5
    assert next_policy(_policy(), [3.0, 2.0, nan], 2).budget_per_session == 5
