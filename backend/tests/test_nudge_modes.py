"""Per-mode buzz rules (plan.md 4.5): regular = pace only, practice = drill rules, no filler."""
from backend.contracts import Metrics, MotionSnapshot
from backend.nudge import NudgeEngine
from backend.nudge import modes
from backend.studio import default_coach


def _snap(**kw):
    base = dict(talk_ratio=0.5, interruptions=0, questions=0, fillers_per_min=0.0, wpm=150.0, baseline_wpm=None,
                monologue_s=0.0, volume_db=-30.0, volume_state="ok", hand_energy=0.5)
    base.update(kw)
    return Metrics(**base)


def _tick(engine, now, **kw):
    return engine.on_tick(_snap(**kw), MotionSnapshot(), now) if hasattr(engine, "on_tick") else None


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
