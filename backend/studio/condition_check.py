"""Strict checker for coach rule conditions (plan.md 4.5), used only for validation.

Allowed form: `<dotted.path> <op> <number>` with op in >= <= > < == !=.
This is stricter than the runtime evaluator on purpose: a coach built in the Studio must
only use paths the brain actually fills. It can later delegate parsing to
`backend.nudge.conditions.parse_condition` and keep the semantic checks here.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass

from backend.contracts import ChoiceQuestion, CoachQuestion, NoulQuestion, ScoreQuestion

_RE = re.compile(
    r"^\s*([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)\s*(>=|<=|==|!=|>|<)\s*(-?\d+(?:\.\d+)?)\s*$"
)

METRIC_FIELDS: frozenset[str] = frozenset({
    "talk_ratio", "interruptions", "questions", "fillers_per_min", "wpm", "monologue_s",
    "volume_db", "hand_energy",
})
MOTION_FIELDS: frozenset[str] = frozenset({"fidget_while_other_s"})
# Old spelling some coaches used; the brain fills `fidget_while_other_s` (contracts.MotionSnapshot).
LEGACY_MOTION_ALIASES: dict[str, str] = {"fidget_while_listening_s": "fidget_while_other_s"}

_UNIT_METRICS = frozenset({"talk_ratio", "hand_energy"})


@dataclass(frozen=True)
class ParsedCondition:
    path: tuple[str, ...]
    op: str
    value: float


def parse_strict(expr: str) -> ParsedCondition:
    """Syntax only. Raises ValueError with a readable message."""
    m = _RE.match(expr or "")
    if not m:
        if "'" in (expr or "") or '"' in (expr or ""):
            raise ValueError(f"condition {expr!r} compares with a string; only numbers are allowed "
                             "(for a choice use judge.<question>.probabilities.<option> >= 0.7)")
        raise ValueError(f"cannot parse condition {expr!r}; expected '<path> <op> <number>'")
    path, op, raw = m.groups()
    return ParsedCondition(tuple(path.split(".")), op, float(raw))


def _check_range(c: ParsedCondition, lo: float, hi: float, what: str) -> str | None:
    """Reject values outside [lo, hi] and comparisons that can never or always hold."""
    v, op = c.value, c.op
    if not lo <= v <= hi:
        return f"{what} lies within {lo:g}-{hi:g}, but it is compared with {v:g}"
    never = (op == ">" and v >= hi) or (op == "<" and v <= lo)
    always = (op == ">=" and v <= lo) or (op == "<=" and v >= hi)
    if never:
        return f"'{what} {op} {v:g}' can never be true"
    if always:
        return f"'{what} {op} {v:g}' is always true"
    return None


def _check_unit(c: ParsedCondition, what: str) -> str | None:
    return _check_range(c, 0.0, 1.0, what)


def _check_judge(c: ParsedCondition, questions: Mapping[str, CoachQuestion]) -> str | None:
    if len(c.path) < 3:
        return "judge paths look like judge.<question>.p|score|confidence|probabilities.<choice>"
    qid, field = c.path[1], c.path[2]
    q = questions.get(qid)
    if q is None:
        return f"judge.{qid} is not a core question or a question defined in this coach"
    if field == "confidence" and len(c.path) == 3:
        return _check_unit(c, f"judge.{qid}.confidence")
    if field == "p" and len(c.path) == 3:
        if not isinstance(q, NoulQuestion):
            return f"judge.{qid}.p is only valid for yes/no (noul) questions; {qid} is {q.type}"
        return _check_unit(c, f"judge.{qid}.p")
    if field == "score" and len(c.path) == 3:
        if not isinstance(q, ScoreQuestion):
            return f"judge.{qid}.score is only valid for score questions; {qid} is {q.type}"
        return _check_range(c, 1.0, float(len(q.criteria)), f"judge.{qid}.score")
    if field == "probabilities" and len(c.path) == 4:
        if not isinstance(q, ChoiceQuestion):
            return f"judge.{qid}.probabilities is only valid for choice questions; {qid} is {q.type}"
        if c.path[3] not in q.criteria:
            return f"judge.{qid}.probabilities.{c.path[3]}: {c.path[3]!r} is not one of {sorted(q.criteria)}"
        return _check_unit(c, f"judge.{qid}.probabilities.{c.path[3]}")
    return f"unknown judge field {'.'.join(c.path[2:])!r} (use p, score, confidence or probabilities.<choice>)"


def _check_metrics(c: ParsedCondition) -> str | None:
    if len(c.path) != 2 or c.path[1] not in METRIC_FIELDS:
        return f"unknown metric {'.'.join(c.path)!r}; metrics are {sorted(METRIC_FIELDS)}"
    name = c.path[1]
    if name in _UNIT_METRICS:
        return _check_unit(c, f"metrics.{name}")
    if name != "volume_db" and c.value < 0:
        return f"metrics.{name} is never negative, but it is compared with {c.value:g}"
    return None


def _check_motion(c: ParsedCondition) -> str | None:
    if len(c.path) == 2 and c.path[1] in LEGACY_MOTION_ALIASES:
        return f"motion.{c.path[1]} is not filled at runtime; use motion.{LEGACY_MOTION_ALIASES[c.path[1]]}"
    if len(c.path) != 2 or c.path[1] not in MOTION_FIELDS:
        return f"unknown motion field {'.'.join(c.path)!r}; motion fields are {sorted(MOTION_FIELDS)}"
    if c.value < 0:
        return f"motion.{c.path[1]} is never negative, but it is compared with {c.value:g}"
    return None


def check_condition(expr: str, questions: Mapping[str, CoachQuestion]) -> str | None:
    """None if `expr` is valid against `questions` (core + coach questions), else an error."""
    try:
        c = parse_strict(expr)
    except ValueError as exc:
        return str(exc)
    root = c.path[0]
    if root == "judge":
        return _check_judge(c, questions)
    if root == "metrics":
        return _check_metrics(c)
    if root == "motion":
        return _check_motion(c)
    return f"path must start with judge., metrics. or motion., got {root!r}"
