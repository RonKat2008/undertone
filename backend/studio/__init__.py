"""Coach Studio (plan.md 4.7): coach library, builder, validation, personal coach.

FINAL PUBLIC INTERFACE (do not change signatures; add private modules inside backend/studio/):

    async def build_coach(goal: str) -> CoachSpec          # Gemini 3.8 Flash -> validated CoachSpec
    def validate_coach(spec: CoachSpec) -> list[str]       # [] means valid; else human-readable errors
    def load_prebuilt() -> list[CoachSpec]                 # backend/studio/prebuilt/*.json
    def build_personal_coach(profile: HabitProfile) -> CoachSpec   # kind "personal"
    def default_coach() -> CoachSpec                       # always valid, no I/O
    router: APIRouter                                       # routes in backend/studio/routes.py

Coach lookup order used by the brain: db.load_coach(id) -> load_prebuilt() -> default_coach().
STUB: build_coach / build_personal_coach derive from default_coach without calling Gemini.
"""

from __future__ import annotations

import json
import logging
import re

from backend.config import PREBUILT_COACHES_DIR
from backend.contracts import CoachSpec, HabitProfile, NudgePolicy
from backend.nudge.conditions import ConditionError, parse_condition
from backend.studio.default import default_coach

log = logging.getLogger("undertone.studio")

__all__ = ["build_coach", "build_personal_coach", "default_coach", "load_prebuilt", "router",
           "validate_coach"]

_QID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def validate_coach(spec: CoachSpec) -> list[str]:
    errors: list[str] = []
    for qid in spec.questions:
        if not _QID.match(qid):
            errors.append(f"question key {qid!r} must match [A-Za-z0-9_-]{{1,64}}")
    rule_ids = [r.id for r in [*spec.nudge_rules, *spec.motion_rules]]
    if len(rule_ids) != len(set(rule_ids)):
        errors.append("rule ids must be unique")
    for rule in [*spec.nudge_rules, *spec.motion_rules]:
        try:
            parse_condition(rule.when)
        except ConditionError as exc:
            errors.append(f"rule {rule.id}: {exc}")
    if spec.nudge_policy.focus_rule_id not in rule_ids:
        errors.append(f"nudge_policy.focus_rule_id {spec.nudge_policy.focus_rule_id!r} is not a rule id")
    if not 0 <= spec.confidence_threshold <= 1:
        errors.append("confidence_threshold must be within 0-1")
    return errors


def load_prebuilt() -> list[CoachSpec]:
    coaches: list[CoachSpec] = []
    if not PREBUILT_COACHES_DIR.is_dir():
        return coaches
    for path in sorted(PREBUILT_COACHES_DIR.glob("*.json")):
        try:
            spec = CoachSpec.model_validate(json.loads(path.read_text()))
        except Exception as exc:
            log.warning("skipping invalid prebuilt coach %s: %s", path.name, exc)
            continue
        errs = validate_coach(spec)
        if errs:
            log.warning("skipping prebuilt coach %s: %s", path.name, "; ".join(errs))
            continue
        coaches.append(spec)
    return coaches


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "coach"


async def build_coach(goal: str) -> CoachSpec:
    """STUB: the default coach re-labelled with the goal. Worker: Gemini structured output."""
    base = default_coach()
    return base.model_copy(update={"id": f"custom-{_slug(goal)}", "name": goal[:60], "goal": goal,
                                   "kind": "custom"})


def build_personal_coach(profile: HabitProfile) -> CoachSpec:
    """STUB: default coach with the wearer's crutch words. Worker: rules from recurring issues."""
    base = default_coach()
    words = [c.word for c in profile.crutch_words[:5]] or base.filler_words
    policy = NudgePolicy(focus_rule_id="filler", budget_per_session=10, min_gap_s=20, tolerance=0.15,
                         silent=False)
    return base.model_copy(update={
        "id": "personal", "name": "Your personal coach", "kind": "personal",
        "goal": "Drill your own crutch words: catch each one and replace it with a pause.",
        "filler_words": words, "keyterms": words, "nudge_policy": policy,
    })


from backend.studio.routes import router  # noqa: E402  (routes import the functions above)
