"""Prebuilt coaches, "How am I doing?", and a scripted realistic session."""

from __future__ import annotations

import pytest

from backend.contracts import Metrics, MotionSnapshot
from backend.nudge import NudgeEngine
from backend.nudge.conditions import parse_condition
from backend.tests.test_nudge_support import coach, load_prebuilt, noul, rule, set_demo, wall


@pytest.fixture(autouse=True)
def _no_demo(monkeypatch: pytest.MonkeyPatch) -> None:
    set_demo(monkeypatch, False)


@pytest.mark.parametrize("name", ["interview", "listener"])
def test_prebuilt_coach_rules_all_parse_and_compile(name: str) -> None:
    c = load_prebuilt(name)
    for r in [*c.nudge_rules, *c.motion_rules]:
        parse_condition(r.when)
    e = NudgeEngine(c, c.nudge_policy)
    assert len(e._rules) == len(c.nudge_rules) + len(c.motion_rules)


# ---------- status reply ----------
def _status_engine(talk_rule: bool) -> NudgeEngine:
    rules = [rule("talk", "metrics.talk_ratio > 0.4")] if talk_rule else [rule("x", "metrics.wpm > 190")]
    c = coach(rules, rules[0].id)
    return NudgeEngine(c, c.nudge_policy)


def test_status_uses_coach_talk_target() -> None:
    assert _status_engine(True).status_reply(Metrics(talk_ratio=0.5, questions=1), 10.0).verdict == "talking_too_much"
    assert _status_engine(False).status_reply(Metrics(talk_ratio=0.5, questions=1), 10.0).verdict == "good"
    r = _status_engine(False).status_reply(Metrics(talk_ratio=0.7), 10.0)
    assert (r.verdict, r.haptic, r.ts) == ("talking_too_much", "status_talking", 10.0)


def test_status_ask_when_no_question_yet_after_60s() -> None:
    e = _status_engine(False)
    assert e.status_reply(Metrics(talk_ratio=0.3), 30.0).verdict == "good"
    r = e.status_reply(Metrics(talk_ratio=0.3), 61.0)
    assert (r.verdict, r.haptic) == ("ask_question", "status_ask")


def test_status_ask_when_last_question_over_2_min_ago() -> None:
    e = _status_engine(False)
    e.evaluate(None, Metrics(questions=1), None, 10.0, wall())  # question seen at t=10
    assert e.status_reply(Metrics(talk_ratio=0.3, questions=1), 100.0).verdict == "good"
    assert e.status_reply(Metrics(talk_ratio=0.3, questions=1), 131.0).verdict == "ask_question"
    assert e.status_reply(Metrics(talk_ratio=0.3, questions=2), 140.0).verdict == "good"


def test_status_never_uses_budget() -> None:
    e = _status_engine(True)
    for t in range(10):
        e.status_reply(Metrics(talk_ratio=0.9), float(t))
    assert e.budget_left == 5


# ---------- scripted session on the Listener coach ----------
def test_listener_session_script() -> None:
    c = load_prebuilt("listener")  # focus: interrupt, budget 5, gap 60
    e = NudgeEngine(c, c.nudge_policy)
    calm = Metrics(talk_ratio=0.3, questions=1)
    buzzes: list[tuple[float, str, int]] = []
    quiet: list[str] = []

    def step(t: float, judge: object = None, metrics: Metrics = calm, motion: MotionSnapshot | None = None) -> None:
        n = e.evaluate(judge, metrics, motion, t, wall())  # type: ignore[arg-type]
        if n is not None:
            buzzes.append((t, n.rule_id, n.budget_left))
        quiet.extend(m.rule_id for m in e.drain_quiet_marks())

    step(5.0)                                                   # nothing
    step(10.0, noul("interrupted", 0.92))                       # focus -> buzz (4 left)
    step(20.0, noul("self_redirect", 0.9))                      # non-focus -> quiet
    step(30.0, metrics=Metrics(talk_ratio=0.55, questions=1))   # talk_share -> quiet
    step(40.0, noul("interrupted", 0.95))                       # gap: quiet, no buzz
    step(45.0, motion=MotionSnapshot(fidget_while_other_s=9))   # motion -> quiet
    step(75.0, noul("interrupted", 0.9, confidence=0.6))        # low confidence -> nothing
    for k, t in enumerate([80.0, 150.0, 220.0, 290.0]):         # four more focus buzzes
        step(t, noul("interrupted", 0.9))
    step(400.0, noul("interrupted", 0.99))                      # budget spent -> quiet

    assert buzzes == [(10.0, "interrupt", 4), (80.0, "interrupt", 3), (150.0, "interrupt", 2),
                      (220.0, "interrupt", 1), (290.0, "interrupt", 0)]
    assert quiet == ["self_redirect", "talk_share", "interrupt", "fidget_listening", "interrupt"]
    assert e.budget_left == 0
    assert {m.rule_id for m in e.quiet_marks} == {"self_redirect", "talk_share", "interrupt", "fidget_listening"}


def test_interview_pace_with_baseline_and_demo(monkeypatch: pytest.MonkeyPatch) -> None:
    set_demo(monkeypatch, True)
    c = load_prebuilt("interview")
    policy = c.nudge_policy.model_copy(update={"min_gap_s": 10, "budget_per_session": 8})
    e = NudgeEngine(c, policy)
    assert e.evaluate(None, Metrics(wpm=200, baseline_wpm=160), None, 0.0, wall()) is None  # band 208
    n = e.evaluate(None, Metrics(wpm=210, baseline_wpm=160), None, 1.0, wall())
    assert n is not None and n.rule_id == "pace" and n.budget_left == 7
