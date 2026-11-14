"""Tests for the hand-written rule-condition parser and evaluator."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from backend.contracts import CoachSpec
from backend.nudge.conditions import (
    PATH_ALIASES,
    Condition,
    ConditionError,
    evaluate_condition,
    evaluate_parsed,
    parse_condition,
)

PREBUILT = Path(__file__).resolve().parents[1] / "studio" / "prebuilt"


def _env() -> dict[str, Any]:
    return {
        "judge": {
            "interrupted": {"kind": "noul", "p": 0.9, "confidence": 0.95},
            "bottom_line_first": {"kind": "likert", "score": 2, "max": 4, "confidence": 0.7},
            "question_type": {
                "kind": "categorical",
                "choice": "none",
                "probabilities": {"none": 0.7, "open": 0.2, "closed-ish": 0.1},
            },
            "nulled": {"kind": "noul", "p": None},
        },
        "metrics": {"monologue_s": 50.0, "wpm": 190, "talk_ratio": 0.45, "baseline_wpm": None},
        "motion": {"state": "fidget", "fidget_while_other_s": 9.0, "hand_energy": -0.5},
    }


# ---------- valid parses ----------


@pytest.mark.parametrize(
    ("expr", "path", "op", "value"),
    [
        ("judge.interrupted.p >= 0.8", ("judge", "interrupted", "p"), ">=", 0.8),
        ("judge.bottom_line_first.score <= 2", ("judge", "bottom_line_first", "score"), "<=", 2.0),
        ("judge.q.confidence > 0.5", ("judge", "q", "confidence"), ">", 0.5),
        ("judge.q.max == 4", ("judge", "q", "max"), "==", 4.0),
        (
            "judge.question_type.probabilities.none > 0.5",
            ("judge", "question_type", "probabilities", "none"),
            ">",
            0.5,
        ),
        ("judge.question_type.choice == 'none'", ("judge", "question_type", "choice"), "==", "none"),
        ('judge.question_type.choice != "open"', ("judge", "question_type", "choice"), "!=", "open"),
        ("metrics.monologue_s > 45", ("metrics", "monologue_s"), ">", 45.0),
        ("metrics.wpm>190", ("metrics", "wpm"), ">", 190.0),
        ("  metrics.wpm   <   -3  ", ("metrics", "wpm"), "<", -3.0),
        ("motion.fidget_while_other_s > 8", ("motion", "fidget_while_other_s"), ">", 8.0),
        ("motion.fidget_while_listening_s > 8", ("motion", "fidget_while_other_s"), ">", 8.0),
        ("motion.state == 'fidget'", ("motion", "state"), "==", "fidget"),
        ("judge.self-redirect.p == true", ("judge", "self-redirect", "p"), "==", True),
        ("judge.q.p != false", ("judge", "q", "p"), "!=", False),
    ],
)
def test_parse_valid(expr: str, path: tuple[str, ...], op: str, value: float | str | bool) -> None:
    cond = parse_condition(expr)
    assert cond == Condition(path, op, value)
    assert type(cond.value) is type(value)


def test_alias_constant() -> None:
    assert PATH_ALIASES == {("motion", "fidget_while_listening_s"): ("motion", "fidget_while_other_s")}


# ---------- evaluation ----------


@pytest.mark.parametrize(
    ("expr", "expected"),
    [
        ("judge.interrupted.p >= 0.8", True),
        ("judge.interrupted.p >= 0.9", True),
        ("judge.interrupted.p > 0.9", False),
        ("judge.interrupted.p < 0.9", False),
        ("judge.interrupted.p <= 0.9", True),
        ("judge.interrupted.p == 0.9", True),
        ("judge.interrupted.p != 0.9", False),
        ("judge.interrupted.confidence > 0.9", True),
        ("judge.bottom_line_first.score <= 2", True),
        ("judge.bottom_line_first.score < 2", False),
        ("judge.question_type.probabilities.none > 0.5", True),
        ("judge.question_type.probabilities.closed-ish < 0.2", True),
        ("judge.question_type.choice == 'none'", True),
        ("judge.question_type.choice != 'none'", False),
        ("metrics.monologue_s > 45", True),
        ("metrics.wpm >= 190", True),
        ("metrics.wpm>190", False),
        ("motion.fidget_while_other_s > 8", True),
        ("motion.fidget_while_listening_s > 8", True),
        ("motion.fidget_while_listening_s > 9", False),
        ("motion.state == 'fidget'", True),
        ("motion.state == 'still'", False),
        ("motion.hand_energy < -0.4", True),
        ("motion.hand_energy > -0.4", False),
    ],
)
def test_evaluate(expr: str, expected: bool) -> None:
    assert evaluate_condition(expr, _env()) is expected
    assert evaluate_parsed(parse_condition(expr), _env()) is expected


@pytest.mark.parametrize(
    "expr",
    [
        "judge.missing.p >= 0.1",
        "judge.nulled.p >= 0.0",
        "metrics.baseline_wpm > 0",
        "metrics.questions > 0",
        "judge.question_type.probabilities.closed > 0",
        "motion.speaker_context == 'other'",
    ],
)
def test_missing_or_none_is_false(expr: str) -> None:
    parse_condition(expr)  # syntactically valid
    assert evaluate_condition(expr, _env()) is False


@pytest.mark.parametrize(
    ("env", "expr"),
    [
        ({"metrics": {"wpm": True}}, "metrics.wpm > 0"),
        ({"metrics": {"wpm": "200"}}, "metrics.wpm > 0"),
        ({"metrics": {"wpm": float("nan")}}, "metrics.wpm != 1"),
        ({"metrics": {"wpm": [1]}}, "metrics.wpm > 0"),
        ({"metrics": 5}, "metrics.wpm > 0"),
        ({"motion": {"state": 1}}, "motion.state == 'fidget'"),
        ({"judge": {"q": {"p": 1}}}, "judge.q.p == true"),
        ({"judge": {"q": "x"}}, "judge.q.p > 0"),
        ({}, "metrics.wpm > 0"),
    ],
)
def test_type_mismatch_is_false(env: dict[str, Any], expr: str) -> None:
    assert evaluate_condition(expr, env) is False


@pytest.mark.parametrize("env", [None, 5, "x", [], {"metrics": None}])
def test_weird_env_never_raises(env: Any) -> None:
    assert evaluate_condition("metrics.wpm > 0", env) is False


# ---------- malformed ----------


@pytest.mark.parametrize(
    ("expr", "fragment"),
    [
        ("", "empty"),
        ("   ", "empty"),
        ("metrics.wpm >", "expected a value after '>'"),
        ("> 5", "expected a path"),
        ("metrics.wpm >> 5", "unknown operator '>>'"),
        ("metrics.wpm > 5 5", "trailing input"),
        ("metrics.wpm > abc", "expected a value after '>'"),
        ("metrics.unknown > 1", "unknown metrics field 'unknown'"),
        ("foo.bar > 1", "unknown root 'foo'"),
        ("judge.q > 1", "judge path"),
        ("judge.q.p.x > 1", "judge path"),
        ("judge.q.nope > 1", "unknown judge attribute 'nope'"),
        ("judge.q.probabilities > 1", "judge path"),
        ("judge.q.probabilities.a.b > 1", "judge path"),
        ("metrics.wpm.x > 1", "metrics path must be"),
        ("motion.nope > 1", "unknown motion field 'nope'"),
        ("metrics.wpm > 'fast'", "requires a number"),
        ("metrics.wpm >= true", "requires a number"),
        ("metrics.wpm 5", "expected an operator"),
        ("metrics.wpm = 5", "unknown operator '='"),
        ("metrics.wpm => 5", "unknown operator '=>'"),
        ("metrics.wpm > 'open", "unterminated string"),
        ("metrics. > 1", "expected a path segment"),
        ("metrics.wpm. > 1", "expected a path segment"),
        ("metrics.wpm > 1.", "expected a number"),
        ("metrics.wpm > --1", "expected a number"),
        ("metrics.wpm > .5", "expected a value"),
        ("metrics.wpm > 0x10", "trailing input"),
        ("metrics.wpm > 1e5", "trailing input"),
        ("metrics.wpm > True", "expected a value"),
        ("metrics", "expected an operator"),
        ("metrics.wpm", "expected an operator"),
    ],
)
def test_malformed(expr: str, fragment: str) -> None:
    with pytest.raises(ConditionError) as info:
        parse_condition(expr)
    assert isinstance(info.value, ValueError)
    assert fragment in str(info.value)
    assert evaluate_condition(expr, _env()) is False


@pytest.mark.parametrize(
    "expr",
    [
        "__import__('os').system('x')",
        "metrics.__class__ > 0",
        "judge.__class__.p > 0",
        "judge.q.probabilities.__dict__ > 0",
        "metrics.wpm > 1; import os",
        "metrics.wpm > 1e999999",
        "metrics.wpm > " + "9" * 400,
        "x" * 10_000,
        "metrics.wpm > " + "1" * 10_000,
        "judge.x.p >= 0.8 or 1",
        "judge.x.p >= 0.8 and judge.y.p >= 0.8",
        "(metrics.wpm > 1)",
        "metrics.wpm() > 1",
        "metrics['wpm'] > 1",
        "metrics.wpm > 1\nmetrics.wpm > 2",
        "metrics.wpm\x00 > 1",
        "metrics.wpm > ١",
        "métrics.wpm > 1",
    ],
)
def test_hostile(expr: str) -> None:
    with pytest.raises(ConditionError):
        parse_condition(expr)
    assert evaluate_condition(expr, _env()) is False


def test_dunder_message() -> None:
    with pytest.raises(ConditionError, match="dunder"):
        parse_condition("metrics.__class__ > 0")


def test_length_cap_message() -> None:
    with pytest.raises(ConditionError, match="too long"):
        parse_condition("metrics.wpm > " + "1" * 300)


@pytest.mark.parametrize("bad", [None, 5, 1.5, b"metrics.wpm > 1", ["metrics.wpm > 1"], object()])
def test_non_str_input(bad: Any) -> None:
    with pytest.raises(ConditionError):
        parse_condition(bad)
    assert evaluate_condition(bad, _env()) is False


def test_evaluate_parsed_with_bad_env() -> None:
    cond = parse_condition("metrics.wpm > 1")
    assert evaluate_parsed(cond, None) is False  # type: ignore[arg-type]


# ---------- prebuilt coaches ----------


@pytest.mark.parametrize("name", ["interview.json", "listener.json"])
def test_prebuilt_coaches_parse(name: str) -> None:
    spec = CoachSpec.model_validate_json((PREBUILT / name).read_text())
    rules = [*spec.nudge_rules, *spec.motion_rules]
    assert rules
    for rule in rules:
        cond = parse_condition(rule.when)
        assert cond.path[0] in {"judge", "metrics", "motion"}
