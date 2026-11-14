"""Per-mode buzz rules (plan.md 4.5): regular = pace only, practice = drill rules, no filler."""
from backend.tests.test_band_bridge import _stub_fastapi_if_missing

_stub_fastapi_if_missing()  # backend.studio imports its routes; a no-op where fastapi is installed

from backend.nudge import modes  # noqa: E402
from backend.studio import default_coach  # noqa: E402


def test_regular_policy_is_pace_only_with_budget_and_gap():
    coach = modes.with_pace_rule(default_coach())
    p = modes.regular_policy(coach, demo=False)
    assert p.focus_rule_id == "pace" and p.budget_per_session == 3 and p.min_gap_s == 120
    assert modes.regular_policy(coach, demo=True).min_gap_s == 30


def test_coach_without_pace_rule_gets_one():
    coach = default_coach()
    stripped = coach.model_copy(update={"nudge_rules": [r for r in coach.nudge_rules if r.id != "pace"]})
    assert modes.pace_rule_id(stripped) is None
    assert modes.pace_rule_id(modes.with_pace_rule(stripped)) == "pace"


def test_practice_policy_has_no_real_cap():
    p = modes.practice_policy(default_coach())
    assert p.budget_per_session >= 50 and p.min_gap_s <= 5 and not p.silent
