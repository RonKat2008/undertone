"""What may buzz in each mode (plan.md 4.5, team decision 14 Nov).

Regular (a real conversation): only pace buzzes (`slow_down`). 3 per session, at least
120 s apart, none in the first 60 s while the baseline settles; tolerance 25% over the
wearer's own pace (190 wpm ceiling as the backup). Everything else is a quiet mark.
Demo: the same rules, except 30 s apart and no warm-up, so the one pace nudge can fire
inside a 50-second conversation.

Practice (a drill): the crutch-word buzz comes from backend/practice.py (word-level, ~1 s);
the engine adds the coach's drill rules (pace, hands, long answer) with no cap. It never
buzzes `filler` itself, so a crutch word is never buzzed twice.
"""
from __future__ import annotations

from backend.contracts import CoachSpec, NudgePolicy, NudgeRule

REGULAR_BUDGET = 3
REGULAR_MIN_GAP_S = 120
REGULAR_TOLERANCE = 0.25
REGULAR_WARMUP_S = 60.0
DEMO_MIN_GAP_S = 30
PRACTICE_BUDGET = 99
PRACTICE_MIN_GAP_S = 3
PACE_RULE = NudgeRule(id="pace", when="metrics.wpm > 190", haptic="slow_down", message="Slow down",
                      cooldown_s=30, enabled=True)


def pace_rule_id(coach: CoachSpec) -> str | None:
    """The coach's own pace rule (a `metrics.wpm >` rule with the slow_down pattern), if any."""
    for r in coach.nudge_rules:
        if r.enabled is not False and "metrics.wpm" in r.when and ">" in r.when and r.haptic == "slow_down":
            return r.id
    return None


def with_pace_rule(coach: CoachSpec) -> CoachSpec:
    """Regular mode needs a pace rule to buzz on; add the default one if the coach has none."""
    if pace_rule_id(coach) is not None:
        return coach
    return coach.model_copy(update={"nudge_rules": [*coach.nudge_rules, PACE_RULE]})


def regular_policy(coach: CoachSpec, demo: bool) -> NudgePolicy:
    base = coach.nudge_policy
    return base.model_copy(update={
        "focus_rule_id": pace_rule_id(coach) or PACE_RULE.id,
        "budget_per_session": REGULAR_BUDGET,
        "min_gap_s": DEMO_MIN_GAP_S if demo else REGULAR_MIN_GAP_S,
        "tolerance": REGULAR_TOLERANCE,
    })


def practice_policy(coach: CoachSpec) -> NudgePolicy:
    return coach.nudge_policy.model_copy(update={
        "budget_per_session": PRACTICE_BUDGET, "min_gap_s": PRACTICE_MIN_GAP_S, "silent": False})
