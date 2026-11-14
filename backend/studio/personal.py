"""STUB (to be replaced by the personal-coach worker)."""

from __future__ import annotations

from backend.contracts import CoachSpec, HabitProfile, NudgePolicy
from backend.studio.default import default_coach


def build_personal_coach(profile: HabitProfile) -> CoachSpec:
    base = default_coach()
    words = [c.word for c in profile.crutch_words[:5]] or base.filler_words
    policy = NudgePolicy(focus_rule_id="filler", budget_per_session=8, min_gap_s=30, tolerance=0.15,
                         silent=False)
    return base.model_copy(update={
        "id": "personal", "name": "Your personal coach", "kind": "personal",
        "goal": "Drill your own crutch words: catch each one and replace it with a pause.",
        "filler_words": words, "keyterms": words, "nudge_policy": policy,
    })
