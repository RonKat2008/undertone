"""Policy state machine of NudgeEngine, driven with an explicit fake clock (`now`)."""

from __future__ import annotations

import pytest

from backend.contracts import Metrics, MotionSnapshot, NudgeQuietEvent
from backend.nudge import NudgeEngine
from backend.tests.test_nudge_support import choice, coach, noul, rule, score, set_demo, wall

M0 = Metrics()


@pytest.fixture(autouse=True)
def _no_demo(monkeypatch: pytest.MonkeyPatch) -> None:
    set_demo(monkeypatch, False)


def engine(rules: list, focus: str, **policy: object) -> NudgeEngine:  # type: ignore[type-arg]
    c = coach(rules, focus, **policy)
    return NudgeEngine(c, c.nudge_policy)


def test_focus_judge_rule_buzzes_with_reason_and_confidence() -> None:
    e = engine([rule("interrupt", "judge.interrupted.p >= 0.8", "interrupt")], "interrupt")
    n = e.evaluate(noul("interrupted", 0.91, confidence=0.93), M0, None, 12.0, wall())
    assert n is not None
    assert (n.rule_id, n.haptic, n.message, n.ts) == ("interrupt", "interrupt", "msg interrupt", 12.0)
    assert n.reason == "interrupted p=0.91"
    assert n.confidence == 0.93 and n.budget_left == 4 and n.latency_ms >= 0


def test_low_confidence_judge_rule_does_not_fire_at_all() -> None:
    e = engine([rule("interrupt", "judge.interrupted.p >= 0.8")], "interrupt")
    assert e.evaluate(noul("interrupted", 0.95, confidence=0.5), M0, None, 1.0, wall()) is None
    assert e.drain_quiet_marks() == []


def test_disabled_rule_ignored() -> None:
    e = engine([rule("mono", "metrics.monologue_s > 45", enabled=False)], "mono")
    assert e.evaluate(None, Metrics(monologue_s=60), None, 1.0, wall()) is None
    assert e.quiet_marks == []


def test_metric_rule_has_no_confidence_and_readable_reason() -> None:
    e = engine([rule("mono", "metrics.monologue_s > 45")], "mono")
    n = e.evaluate(None, Metrics(monologue_s=48), None, 50.0, wall())
    assert n is not None and n.confidence is None and n.reason == "monologue 48 s > 45"


def test_non_focus_rule_becomes_quiet_mark() -> None:
    e = engine([rule("focus", "judge.interrupted.p >= 0.8"), rule("mono", "metrics.monologue_s > 45", "wrap_up")],
               "focus")
    assert e.evaluate(None, Metrics(monologue_s=50), None, 5.0, wall()) is None
    marks = e.drain_quiet_marks()
    assert len(marks) == 1 and isinstance(marks[0], NudgeQuietEvent)
    assert (marks[0].rule_id, marks[0].haptic, marks[0].ts) == ("mono", "wrap_up", 5.0)
    assert e.drain_quiet_marks() == []  # drained
    assert len(e.quiet_marks) == 1  # still kept for the debrief


def test_quiet_marks_deduplicated_by_default_cooldown() -> None:
    e = engine([rule("focus", "judge.x.p >= 0.8"), rule("mono", "metrics.monologue_s > 45", cooldown_s=None)],
               "focus")
    for t in range(0, 45):  # metric stays true, evaluated at 1 Hz
        e.evaluate(None, Metrics(monologue_s=50 + t), None, float(t), wall())
    assert [m.ts for m in e.drain_quiet_marks()] == [0.0, 20.0, 40.0]


def test_budget_counts_down_then_silence() -> None:
    e = engine([rule("mono", "metrics.monologue_s > 45")], "mono", budget_per_session=2, min_gap_s=10)
    hot = Metrics(monologue_s=60)
    a = e.evaluate(None, hot, None, 0.0, wall())
    b = e.evaluate(None, hot, None, 10.0, wall())
    c = e.evaluate(None, hot, None, 30.0, wall())
    assert a and b and a.budget_left == 1 and b.budget_left == 0 and c is None
    assert e.budget_left == 0
    assert [m.rule_id for m in e.drain_quiet_marks()] == ["mono"]  # fired but budget spent


def test_min_gap_between_buzzes() -> None:
    e = engine([rule("mono", "metrics.monologue_s > 45")], "mono", min_gap_s=60)
    hot = Metrics(monologue_s=60)
    assert e.evaluate(None, hot, None, 0.0, wall()) is not None
    assert e.evaluate(None, hot, None, 59.0, wall()) is None
    assert e.evaluate(None, hot, None, 60.0, wall()) is not None


def test_per_rule_cooldown() -> None:
    e = engine([rule("mono", "metrics.monologue_s > 45", cooldown_s=90)], "mono", min_gap_s=10)
    hot = Metrics(monologue_s=60)
    assert e.evaluate(None, hot, None, 0.0, wall()) is not None
    assert e.evaluate(None, hot, None, 60.0, wall()) is None
    assert e.evaluate(None, hot, None, 90.0, wall()) is not None


def test_silent_policy_never_buzzes_but_marks() -> None:
    e = engine([rule("mono", "metrics.monologue_s > 45")], "mono", silent=True)
    assert e.evaluate(None, Metrics(monologue_s=60), None, 0.0, wall()) is None
    assert [m.rule_id for m in e.drain_quiet_marks()] == ["mono"]
    assert e.budget_left == 5


def test_snooze_keeps_rule_quiet_for_session() -> None:
    e = engine([rule("mono", "metrics.monologue_s > 45")], "mono", min_gap_s=0)
    e.snooze("mono", 1.0)
    for t in (2.0, 500.0, 5000.0):
        assert e.evaluate(None, Metrics(monologue_s=60), None, t, wall()) is None


def test_one_nudge_per_call_focus_wins_then_confidence(monkeypatch: pytest.MonkeyPatch) -> None:
    set_demo(monkeypatch, True)
    rules = [rule("a", "judge.a.p >= 0.5"), rule("b", "judge.b.p >= 0.5"), rule("f", "metrics.wpm > 100")]
    e = engine(rules, "f", min_gap_s=0)
    j = noul("a", 0.9, confidence=0.85, b=noul("b", 0.9, 0.99).results["b"])
    n = e.evaluate(j, Metrics(wpm=150), None, 0.0, wall())
    assert n is not None and n.rule_id == "f"
    assert {m.rule_id for m in e.drain_quiet_marks()} == {"a", "b"}
    n2 = e.evaluate(j, Metrics(wpm=50), None, 100.0, wall())
    assert n2 is not None and n2.rule_id == "b"  # higher confidence wins among non-focus


def test_demo_mode_lets_any_rule_buzz_with_policy_budget(monkeypatch: pytest.MonkeyPatch) -> None:
    set_demo(monkeypatch, True)
    e = engine([rule("f", "judge.x.p >= 0.8"), rule("mono", "metrics.monologue_s > 45")], "f",
               budget_per_session=8, min_gap_s=10)
    n = e.evaluate(None, Metrics(monologue_s=60), None, 0.0, wall())
    assert n is not None and n.rule_id == "mono" and n.budget_left == 7
    assert e.evaluate(None, Metrics(monologue_s=60), None, 5.0, wall()) is None  # gap still applies


@pytest.mark.parametrize(("baseline", "wpm", "fires"), [
    (None, 191, True), (None, 189, False),       # no baseline: rule threshold as written
    (150, 191, False), (150, 196, True),         # 150 * 1.3 = 195 is above 190
    (100, 185, False), (100, 191, True),         # 100 * 1.3 = 130 below 190: keep 190
])
def test_tolerance_band_only_on_pace(baseline: float | None, wpm: float, fires: bool) -> None:
    e = engine([rule("pace", "metrics.wpm > 190", "slow_down")], "pace")
    n = e.evaluate(None, Metrics(wpm=wpm, baseline_wpm=baseline), None, 0.0, wall())
    assert (n is not None) is fires


def test_tolerance_reason_mentions_baseline() -> None:
    e = engine([rule("pace", "metrics.wpm > 190")], "pace")
    n = e.evaluate(None, Metrics(wpm=200, baseline_wpm=150), None, 0.0, wall())
    assert n is not None and n.reason == "wpm 200 > 195 (baseline 150 +30%)"


def test_fixed_thresholds_ignore_tolerance() -> None:
    e = engine([rule("talk", "metrics.talk_ratio > 0.4")], "talk")
    n = e.evaluate(None, Metrics(talk_ratio=0.41, baseline_wpm=150), None, 31.0, wall())
    assert n is not None


@pytest.mark.parametrize("when", ["metrics.fillers_per_min > 8", "metrics.talk_ratio > 0.4"])
def test_rate_rules_wait_for_warmup(when: str) -> None:
    e = engine([rule("r", when)], "r", min_gap_s=0)
    hot = Metrics(fillers_per_min=12.5, talk_ratio=1.0)
    assert e.evaluate(None, hot, None, 29.0, wall()) is None
    assert e.drain_quiet_marks() == []
    assert e.evaluate(None, hot, None, 30.0, wall()) is not None


def test_success_rule_buzzes_once_without_being_focus() -> None:
    rules = [rule("focus", "judge.x.p >= 0.8"), rule("win", "judge.listening_depth.score >= 4", "success")]
    e = engine(rules, "focus", min_gap_s=10)
    assert e.evaluate(score("listening_depth", 4), M0, None, 0.0, wall()) is not None
    assert e.evaluate(score("listening_depth", 4), M0, None, 100.0, wall()) is None
    assert e.budget_left == 4


def test_success_rule_respects_gap() -> None:
    rules = [rule("mono", "metrics.monologue_s > 45"), rule("win", "judge.d.score >= 4", "success")]
    e = engine(rules, "mono", min_gap_s=60)
    assert e.evaluate(None, Metrics(monologue_s=60), None, 0.0, wall()) is not None
    assert e.evaluate(score("d", 4), M0, None, 30.0, wall()) is None
    assert e.evaluate(score("d", 4), M0, None, 61.0, wall()) is not None


def test_probabilities_and_motion_alias_paths() -> None:
    rules = [rule("tone", "judge.tone.probabilities.nervous >= 0.7"),
             rule("fidget", "motion.fidget_while_listening_s > 8", "still")]
    e = engine(rules, "tone", min_gap_s=0)
    n = e.evaluate(choice("tone", {"nervous": 0.8, "calm": 0.2}), M0, MotionSnapshot(fidget_while_other_s=9),
                   0.0, wall())
    assert n is not None and n.rule_id == "tone" and n.reason == "tone.nervous p=0.8"
    assert [m.rule_id for m in e.drain_quiet_marks()] == ["fidget"]


def test_invalid_rule_is_skipped_not_raised() -> None:
    e = engine([rule("bad", "__import__('os').system('x')"), rule("mono", "metrics.monologue_s > 45")], "mono")
    assert e.evaluate(None, Metrics(monologue_s=60), None, 0.0, wall()) is not None
