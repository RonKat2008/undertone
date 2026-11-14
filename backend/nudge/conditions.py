"""Safe rule-condition evaluator (plan.md 4.5). NEVER uses eval/exec.

FINAL PUBLIC INTERFACE:
    def evaluate_condition(expr: str, env: dict) -> bool
    def parse_condition(expr: str) -> Condition          # raises ConditionError if invalid

Grammar (the worker may extend with `and` / `or`, but must keep these working):
    <dotted.path> <op> <number|'string'|true|false>     op in  >= <= > < == !=
Examples: "judge.interrupted.p >= 0.8", "metrics.monologue_s > 45",
          "judge.question_type.choice == 'none'", "motion.state == 'fidget'"

`env` is a nested dict, e.g. {"judge": {"interrupted": {"p": 0.9, ...}}, "metrics": {...},
"motion": {"state": "fidget", "hand_energy": 0.7, "speaker_context": "other", "fidget_s": 9.0}}.
A path that is missing from env makes the condition False (never an error).
"""

from __future__ import annotations

import operator
import re
from dataclasses import dataclass
from typing import Any, Callable

_OPS: dict[str, Callable[[Any, Any], bool]] = {
    ">=": operator.ge, "<=": operator.le, ">": operator.gt, "<": operator.lt,
    "==": operator.eq, "!=": operator.ne,
}
_RE = re.compile(
    r"^\s*([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*)\s*(>=|<=|==|!=|>|<)\s*"
    r"(-?\d+(?:\.\d+)?|'[^']*'|\"[^\"]*\"|true|false)\s*$"
)


class ConditionError(ValueError):
    pass


@dataclass(frozen=True)
class Condition:
    path: tuple[str, ...]
    op: str
    value: float | str | bool


def parse_condition(expr: str) -> Condition:
    m = _RE.match(expr or "")
    if not m:
        raise ConditionError(f"cannot parse condition: {expr!r}")
    path, op, raw = m.groups()
    value: float | str | bool
    if raw in ("true", "false"):
        value = raw == "true"
    elif raw[0] in "'\"":
        value = raw[1:-1]
    else:
        value = float(raw)
    return Condition(tuple(path.split(".")), op, value)


_MISSING = object()


def _lookup(env: dict[str, Any], path: tuple[str, ...]) -> Any:
    cur: Any = env
    for part in path:
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return _MISSING
    return cur


def evaluate_condition(expr: str, env: dict[str, Any]) -> bool:
    """True if the condition holds. Invalid expressions and missing paths give False."""
    try:
        cond = parse_condition(expr)
    except ConditionError:
        return False
    actual = _lookup(env, cond.path)
    if actual is _MISSING or actual is None:
        return False
    try:
        if isinstance(cond.value, float) and not isinstance(actual, bool):
            return _OPS[cond.op](float(actual), cond.value)
        return _OPS[cond.op](actual, cond.value)
    except (TypeError, ValueError):
        return False
