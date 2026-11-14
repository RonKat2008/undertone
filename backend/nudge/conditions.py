"""Safe rule-condition parser and evaluator (plan.md 4.5).

Hand-written tokenizer + parser. NEVER uses eval / exec / compile / ast or any dynamic
evaluation: the input is only ever scanned character by character.

PUBLIC INTERFACE:
    class ConditionError(ValueError)
    class Condition(path, op, value)                       # frozen dataclass
    PATH_ALIASES: dict[tuple[str, ...], tuple[str, ...]]
    def parse_condition(expr: str) -> Condition            # raises ConditionError if invalid
    def evaluate_parsed(cond: Condition, env: dict) -> bool  # never raises
    def evaluate_condition(expr: str, env: dict) -> bool   # never raises

Grammar (whitespace = spaces/tabs, optional around the operator):
    condition := path op literal
    path      := segment ("." segment)*      segment := [A-Za-z_][A-Za-z0-9_-]*
    op        := ">=" | "<=" | ">" | "<" | "==" | "!="
    literal   := number | 'string' | "string" | true | false
    number    := "-"? [0-9]+ ("." [0-9]+)?
No parens, calls, `and`/`or`, exponents or extra tokens. Expressions longer than
MAX_EXPR_LEN characters are rejected.

Valid paths:
    judge.<question_id>.<p|score|confidence|choice|max>
    judge.<question_id>.probabilities.<choice_key>
    metrics.<field of backend.contracts.Metrics>
    motion.<field of backend.contracts.MotionSnapshot>   (+ aliases in PATH_ALIASES)
Segments starting with "__" are always rejected. Ordering operators need a number; string
and bool literals are only allowed with == and !=.

Evaluation: `env` is a nested dict, e.g.
    {"judge": {"interrupted": {"kind": "noul", "p": 0.9, "confidence": 0.95}},
     "metrics": {...}, "motion": {"state": "fidget", "fidget_while_other_s": 9.0}}.
Missing keys, non-dict intermediates, None values and type mismatches give False. Numbers
compare as floats (bools are not numbers; NaN is always False). Judge likert scores on the
wire are 1-based (1..max), so rules such as `judge.x.score <= 2` use them as-is.
"""

from __future__ import annotations

import math
import operator
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Callable

from backend.contracts import Metrics, MotionSnapshot

MAX_EXPR_LEN = 200
_CACHE_SIZE = 512

_OPS: dict[str, Callable[[Any, Any], bool]] = {
    ">=": operator.ge, "<=": operator.le, ">": operator.gt, "<": operator.lt,
    "==": operator.eq, "!=": operator.ne,
}
_EQUALITY_OPS = frozenset({"==", "!="})
_OP_CHARS = frozenset("<>=!")
_WS = frozenset(" \t")
_DIGITS = frozenset("0123456789")
_IDENT_START = frozenset("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_")
_IDENT_CHARS = _IDENT_START | _DIGITS | {"-"}

_ROOTS = ("judge", "metrics", "motion")
_JUDGE_ATTRS = frozenset({"p", "score", "confidence", "choice", "max"})
_METRICS_FIELDS = frozenset(Metrics.model_fields)
PATH_ALIASES: dict[tuple[str, ...], tuple[str, ...]] = {
    ("motion", "fidget_while_listening_s"): ("motion", "fidget_while_other_s"),
}
_MOTION_FIELDS = frozenset(MotionSnapshot.model_fields) | {
    alias[1] for alias in PATH_ALIASES if alias[0] == "motion"
}


class ConditionError(ValueError):
    """The condition string is not valid in the rule grammar."""


@dataclass(frozen=True)
class Condition:
    path: tuple[str, ...]
    op: str
    value: float | str | bool


# ---------- tokenizer / parser ----------


class _Scanner:
    """Cursor over the expression; each method consumes one grammar element."""

    def __init__(self, text: str) -> None:
        self.text = text
        self.pos = 0

    def peek(self) -> str:
        return self.text[self.pos] if self.pos < len(self.text) else ""

    def skip_ws(self) -> None:
        while self.peek() in _WS and self.peek():
            self.pos += 1

    def take_while(self, chars: frozenset[str]) -> str:
        start = self.pos
        while self.peek() and self.peek() in chars:
            self.pos += 1
        return self.text[start:self.pos]

    def path(self) -> tuple[str, ...]:
        if self.peek() not in _IDENT_START or not self.peek():
            raise ConditionError(f"expected a path such as 'metrics.wpm' at position {self.pos}")
        segments = [self.take_while(_IDENT_CHARS)]
        while self.peek() == ".":
            self.pos += 1
            if not self.peek() or self.peek() not in _IDENT_START:
                raise ConditionError(f"expected a path segment after '.' at position {self.pos}")
            segments.append(self.take_while(_IDENT_CHARS))
        return tuple(segments)

    def op(self, after: str) -> str:
        if not self.peek() or self.peek() not in _OP_CHARS:
            raise ConditionError(f"expected an operator (>= <= > < == !=) after {after!r}")
        raw = self.take_while(_OP_CHARS)
        if raw not in _OPS:
            raise ConditionError(f"unknown operator {raw!r} (use >= <= > < == !=)")
        return raw

    def literal(self, op: str) -> float | str | bool:
        ch = self.peek()
        if ch in ("'", '"') and ch:
            return self._string(ch)
        if ch == "-" or (ch and ch in _DIGITS):
            return self._number(op)
        if ch and ch in _IDENT_START:
            word = self.take_while(_IDENT_CHARS)
            if word in ("true", "false"):
                return word == "true"
            raise ConditionError(
                f"expected a value after {op!r} (a number, a quoted string, true or false),"
                f" got {word!r}"
            )
        raise ConditionError(
            f"expected a value after {op!r} (a number, a quoted string, true or false)"
        )

    def _string(self, quote: str) -> str:
        start = self.pos + 1
        end = self.text.find(quote, start)
        if end < 0:
            raise ConditionError(f"unterminated string starting at position {self.pos}")
        self.pos = end + 1
        return self.text[start:end]

    def _number(self, op: str) -> float:
        start = self.pos
        if self.peek() == "-":
            self.pos += 1
        if not self.take_while(_DIGITS):
            raise ConditionError(f"expected a number after {op!r}")
        if self.peek() == ".":
            self.pos += 1
            if not self.take_while(_DIGITS):
                raise ConditionError(
                    f"expected a number after {op!r}, got {self.text[start:self.pos]!r}"
                )
        value = float(self.text[start:self.pos])  # digits-only lexeme, safe to convert
        if not math.isfinite(value):
            raise ConditionError(f"number after {op!r} is too large")
        return value


def _validate_path(path: tuple[str, ...]) -> tuple[str, ...]:
    """Check the path against the known schema; return its canonical (de-aliased) form."""
    for seg in path:
        if seg.startswith("__"):
            raise ConditionError(f"dunder path segment {seg!r} is not allowed")
    root = path[0]
    if root not in _ROOTS:
        raise ConditionError(f"unknown root {root!r} (use judge, metrics or motion)")
    if root == "judge":
        _validate_judge(path)
        return path
    fields = _METRICS_FIELDS if root == "metrics" else _MOTION_FIELDS
    if len(path) != 2:
        raise ConditionError(f"{root} path must be '{root}.<field>', got {'.'.join(path)!r}")
    if path[1] not in fields:
        raise ConditionError(f"unknown {root} field {path[1]!r}")
    return PATH_ALIASES.get(path, path)


def _validate_judge(path: tuple[str, ...]) -> None:
    shape = "judge path must be 'judge.<question>.<attr>' or 'judge.<question>.probabilities.<choice>'"
    if len(path) == 4 and path[2] == "probabilities":
        return
    if len(path) != 3 or path[2] == "probabilities":
        raise ConditionError(f"{shape}, got {'.'.join(path)!r}")
    if path[2] not in _JUDGE_ATTRS:
        raise ConditionError(
            f"unknown judge attribute {path[2]!r} (use p, score, confidence, choice, max"
            " or probabilities.<choice>)"
        )


def _check_types(op: str, value: float | str | bool) -> None:
    if op in _EQUALITY_OPS:
        return
    if isinstance(value, bool) or not isinstance(value, float):
        raise ConditionError(f"operator {op!r} requires a number, got {value!r}")


@lru_cache(maxsize=_CACHE_SIZE)
def _parse_cached(expr: str) -> Condition:
    scanner = _Scanner(expr)
    scanner.skip_ws()
    if not scanner.peek():
        raise ConditionError("empty condition")
    raw_path = scanner.path()
    scanner.skip_ws()
    op = scanner.op(".".join(raw_path))
    scanner.skip_ws()
    value = scanner.literal(op)
    scanner.skip_ws()
    if scanner.peek():
        raise ConditionError(f"trailing input at position {scanner.pos}: {expr[scanner.pos:]!r}")
    path = _validate_path(raw_path)
    _check_types(op, value)
    return Condition(path, op, value)


def parse_condition(expr: str) -> Condition:
    """Parse and validate a rule condition. Raises ConditionError saying what is wrong."""
    if not isinstance(expr, str):
        raise ConditionError(f"condition must be a string, got {type(expr).__name__}")
    if len(expr) > MAX_EXPR_LEN:
        raise ConditionError(f"condition too long ({len(expr)} > {MAX_EXPR_LEN} characters)")
    return _parse_cached(expr)


# ---------- evaluation ----------

_MISSING = object()


def _lookup(env: Any, path: tuple[str, ...]) -> Any:
    cur: Any = env
    for part in path:
        if not isinstance(cur, dict) or part not in cur:
            return _MISSING
        cur = cur[part]
    return cur


def _compare(op: str, actual: Any, expected: float | str | bool) -> bool:
    fn = _OPS.get(op)
    if fn is None:
        return False
    if isinstance(expected, bool):
        return isinstance(actual, bool) and op in _EQUALITY_OPS and bool(fn(actual, expected))
    if isinstance(expected, str):
        return isinstance(actual, str) and op in _EQUALITY_OPS and bool(fn(actual, expected))
    if isinstance(actual, bool) or not isinstance(actual, (int, float)):
        return False
    number = float(actual)
    if math.isnan(number) or math.isnan(float(expected)):
        return False
    return bool(fn(number, float(expected)))


def evaluate_parsed(cond: Condition, env: dict[str, Any]) -> bool:
    """True if an already-parsed condition holds in env. Never raises."""
    try:
        actual = _lookup(env, cond.path)
        if actual is _MISSING or actual is None:
            return False
        return _compare(cond.op, actual, cond.value)
    except Exception:  # noqa: BLE001 - evaluation must never raise into the engine
        return False


def evaluate_condition(expr: str, env: dict[str, Any]) -> bool:
    """True if the condition holds. Invalid expressions and missing paths give False."""
    try:
        cond = parse_condition(expr)
    except ConditionError:
        return False
    except Exception:  # noqa: BLE001 - e.g. unhashable str subclass; never raise
        return False
    return evaluate_parsed(cond, env)
