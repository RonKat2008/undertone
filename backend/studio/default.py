"""The hard-coded Core Coach: always valid, used when nothing else is configured."""

from __future__ import annotations

from backend.contracts import CoachSpec, Drill, NudgePolicy, NudgeRule
from backend.judge.core_questions import CORE_QUESTIONS

DEFAULT_FILLERS = ["um", "uh", "like", "basically", "you know", "actually", "sort of", "kind of",
                   "i mean", "literally"]


def default_coach() -> CoachSpec:
    return CoachSpec(
        id="core",
        name="Core Coach",
        goal="Listen fully, keep turns short, and ask good questions.",
        kind="prebuilt",
        confidence_threshold=0.8,
        keyterms=[],
        filler_words=list(DEFAULT_FILLERS),
        questions=dict(CORE_QUESTIONS),
        nudge_rules=[
            NudgeRule(id="interrupt", when="judge.interrupted.p >= 0.8", haptic="interrupt",
                      message="Let them finish", cooldown_s=20, enabled=True),
            NudgeRule(id="monologue", when="metrics.monologue_s > 45", haptic="wrap_up",
                      message="Ask a question", cooldown_s=45, enabled=True),
            NudgeRule(id="filler", when="metrics.fillers_per_min > 8", haptic="filler",
                      message="Pause instead", cooldown_s=30, enabled=True),
            NudgeRule(id="hedge", when="judge.hedging.p >= 0.85", haptic="filler",
                      message="Say it plainly", cooldown_s=30, enabled=True),
            NudgeRule(id="pace", when="metrics.wpm > 190", haptic="slow_down",
                      message="Slow down", cooldown_s=30, enabled=True),
        ],
        motion_rules=[
            NudgeRule(id="fidget", when="motion.fidget_while_other_s > 8", haptic="still",
                      message="Hands calm", cooldown_s=30, enabled=True),
        ],
        nudge_policy=NudgePolicy(focus_rule_id="interrupt", budget_per_session=5, min_gap_s=60,
                                 tolerance=0.3, silent=False),
        debrief_rubric=("Lead with the most telling fact against the goal, then one real strength, "
                        "one behaviour to fix, and the fix as an if-then plan. Behaviour, never traits."),
        drill=Drill(partner_persona="A friendly colleague who asks follow-up questions.",
                    prompts=["Tell me about a project you're proud of.",
                             "Walk me through how you'd approach a tough decision."]),
    )
