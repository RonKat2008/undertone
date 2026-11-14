"""validate_coach: every rule a live coach must satisfy, as human-readable errors."""

from __future__ import annotations

import re

from backend.contracts import ChoiceQuestion, CoachQuestion, CoachSpec, NudgeRule, ScoreQuestion
from backend.judge.core_questions import CORE_QUESTIONS
from backend.studio.condition_check import check_condition

KEY_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
NUDGE_HAPTICS: frozenset[str] = frozenset(
    {"interrupt", "filler", "wrap_up", "slow_down", "still", "success", "tap"}
)
MAX_MESSAGE_CHARS = 48
CONFIDENCE_RANGE = (0.5, 0.99)
BUDGET_RANGE = (1, 20)
MIN_GAP_RANGE = (0.0, 600.0)
TOLERANCE_RANGE = (0.0, 1.0)
MAX_CHOICES = 255


def all_questions(spec: CoachSpec) -> dict[str, CoachQuestion]:
    """Core questions plus the coach's own (a coach may restate a core question)."""
    return {**CORE_QUESTIONS, **spec.questions}


def is_enabled(rule: NudgeRule) -> bool:
    return rule.enabled is not False


def _question_errors(qid: str, q: CoachQuestion) -> list[str]:
    errors: list[str] = []
    if not KEY_RE.match(qid):
        errors.append(f"question key {qid!r} must match [A-Za-z0-9_-]{{1,64}}")
    if not q.instructions.strip():
        errors.append(f"question {qid}: instructions are empty")
    if isinstance(q, ChoiceQuestion):
        if not 2 <= len(q.criteria) <= MAX_CHOICES:
            errors.append(f"question {qid}: a choice needs 2-{MAX_CHOICES} options, has {len(q.criteria)}")
        for key, desc in q.criteria.items():
            if not KEY_RE.match(key):
                errors.append(f"question {qid}: option key {key!r} must match [A-Za-z0-9_-]{{1,64}}")
            if not desc.strip():
                errors.append(f"question {qid}: option {key!r} has no description")
    if isinstance(q, ScoreQuestion):
        if len(q.criteria) < 2:
            errors.append(f"question {qid}: a score needs at least 2 ordered levels, has {len(q.criteria)}")
        if any(not level.strip() for level in q.criteria):
            errors.append(f"question {qid}: a score level is empty")
    return errors


def _rule_errors(rule: NudgeRule, questions: dict[str, CoachQuestion]) -> list[str]:
    errors: list[str] = []
    label = f"rule {rule.id!r}"
    if not KEY_RE.match(rule.id):
        errors.append(f"{label}: id must match [A-Za-z0-9_-]{{1,64}}")
    problem = check_condition(rule.when, questions)
    if problem:
        errors.append(f"{label}: {problem}")
    if rule.haptic not in NUDGE_HAPTICS:
        errors.append(f"{label}: haptic {rule.haptic!r} is not allowed in rules; use one of {sorted(NUDGE_HAPTICS)}")
    message = rule.message.strip()
    if not message:
        errors.append(f"{label}: message is empty")
    elif len(message) > MAX_MESSAGE_CHARS:
        errors.append(f"{label}: message is {len(message)} chars; keep it under {MAX_MESSAGE_CHARS}")
    if rule.cooldown_s is not None and rule.cooldown_s < 0:
        errors.append(f"{label}: cooldown_s must not be negative")
    return errors


def _policy_errors(spec: CoachSpec, rules: list[NudgeRule]) -> list[str]:
    errors: list[str] = []
    p = spec.nudge_policy
    focus = next((r for r in rules if r.id == p.focus_rule_id), None)
    if focus is None:
        errors.append(f"nudge_policy.focus_rule_id {p.focus_rule_id!r} is not a rule id")
    elif not is_enabled(focus):
        errors.append(f"nudge_policy.focus_rule_id {p.focus_rule_id!r} points at a disabled rule")
    if not BUDGET_RANGE[0] <= p.budget_per_session <= BUDGET_RANGE[1]:
        errors.append(f"nudge_policy.budget_per_session must be within {BUDGET_RANGE[0]}-{BUDGET_RANGE[1]}")
    if not MIN_GAP_RANGE[0] <= p.min_gap_s <= MIN_GAP_RANGE[1]:
        errors.append(f"nudge_policy.min_gap_s must be within {MIN_GAP_RANGE[0]:g}-{MIN_GAP_RANGE[1]:g}")
    if not TOLERANCE_RANGE[0] <= p.tolerance <= TOLERANCE_RANGE[1]:
        errors.append("nudge_policy.tolerance must be within 0-1")
    return errors


def validate_coach(spec: CoachSpec) -> list[str]:
    """[] means valid; otherwise one readable message per problem."""
    errors: list[str] = []
    if not KEY_RE.match(spec.id):
        errors.append(f"coach id {spec.id!r} must match [A-Za-z0-9_-]{{1,64}}")
    if not spec.name.strip():
        errors.append("name is empty")
    if not spec.goal.strip():
        errors.append("goal is empty")
    lo, hi = CONFIDENCE_RANGE
    if not lo <= spec.confidence_threshold <= hi:
        errors.append(f"confidence_threshold {spec.confidence_threshold:g} must be within {lo}-{hi}")
    for qid, q in spec.questions.items():
        errors.extend(_question_errors(qid, q))
    questions = all_questions(spec)
    rules = [*spec.nudge_rules, *spec.motion_rules]
    if not spec.nudge_rules:
        errors.append("nudge_rules is empty; a coach needs at least one rule")
    ids = [r.id for r in rules]
    dupes = sorted({i for i in ids if ids.count(i) > 1})
    if dupes:
        errors.append(f"rule ids must be unique; repeated: {dupes}")
    for rule in rules:
        errors.extend(_rule_errors(rule, questions))
    errors.extend(_policy_errors(spec, rules))
    if not spec.drill.partner_persona.strip():
        errors.append("drill.partner_persona is empty")
    return errors
