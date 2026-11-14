"""Short human reasons for a fired rule, e.g. "interrupted p=0.91" or "monologue 48 s > 45"."""

from __future__ import annotations

from typing import Any

from backend.nudge.conditions import Condition


def _num(x: float) -> str:
    return f"{x:.2f}".rstrip("0").rstrip(".") if x != int(x) else str(int(x))


def _lookup(env: dict[str, Any], path: tuple[str, ...]) -> Any:
    cur: Any = env
    for part in path:
        if not isinstance(cur, dict) or part not in cur:
            return None
        cur = cur[part]
    return cur


def describe(cond: Condition, env: dict[str, Any], original: Condition,
             baseline_wpm: float | None, tolerance: float) -> str:
    value = _lookup(env, cond.path)
    shown = _num(float(value)) if isinstance(value, (int, float)) and not isinstance(value, bool) else str(value)
    target = _num(cond.value) if isinstance(cond.value, float) else str(cond.value)
    root = cond.path[0]
    if root == "judge":
        qid, attr = cond.path[1], cond.path[-1]
        if len(cond.path) == 4:  # judge.<q>.probabilities.<key>
            return f"{qid}.{attr} p={shown}"
        if attr == "p":
            return f"{qid} p={shown}"
        return f"{qid} {attr} {shown} {cond.op} {target}"
    field = cond.path[-1]
    unit = ""
    if field.endswith("_s"):
        field, unit = field[:-2], " s"
    text = f"{field} {shown}{unit} {cond.op} {target}"
    if cond.value != original.value and baseline_wpm:
        text += f" (baseline {_num(baseline_wpm)} +{round(tolerance * 100)}%)"
    return text
