"""Shared builders for the nudge tests (not a test module)."""

from __future__ import annotations

import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.contracts import (
    ChoiceAnswer, CoachSpec, Drill, JudgeEvent, NoulAnswer, NudgePolicy, NudgeRule, ScoreAnswer,
)
from backend.nudge import engine as engine_mod

PREBUILT = Path(__file__).resolve().parents[1] / "studio" / "prebuilt"


def set_demo(monkeypatch: pytest.MonkeyPatch, demo: bool) -> None:
    monkeypatch.setattr(engine_mod, "load_settings", lambda: SimpleNamespace(demo_policy=demo))


def rule(rid: str, when: str, haptic: str = "tap", cooldown_s: float | None = 0,
         enabled: bool | None = True) -> NudgeRule:
    return NudgeRule(id=rid, when=when, haptic=haptic, message=f"msg {rid}",  # type: ignore[arg-type]
                     cooldown_s=cooldown_s, enabled=enabled)


def coach(rules: list[NudgeRule], focus: str, threshold: float = 0.8, **policy: object) -> CoachSpec:
    return CoachSpec(
        id="t", name="T", goal="g", kind="custom", confidence_threshold=threshold,
        nudge_rules=rules, nudge_policy=NudgePolicy(focus_rule_id=focus, **policy),  # type: ignore[arg-type]
        drill=Drill(partner_persona="p"),
    )


def noul(qid: str, p: float, confidence: float = 0.95, **more: object) -> JudgeEvent:
    results: dict[str, object] = {qid: NoulAnswer(p=p, confidence=confidence), **more}
    return JudgeEvent(turn_id="t1", results=results, latency_ms=1.0, source="decisions")  # type: ignore[arg-type]


def score(qid: str, s: float, mx: float = 4, confidence: float = 0.95) -> JudgeEvent:
    return JudgeEvent(turn_id="t1", results={qid: ScoreAnswer(score=s, max=mx, confidence=confidence)},
                      latency_ms=1.0, source="decisions")


def choice(qid: str, probs: dict[str, float], confidence: float = 0.95) -> JudgeEvent:
    top = max(probs, key=lambda k: probs[k])
    return JudgeEvent(turn_id="t1", results={qid: ChoiceAnswer(choice=top, probabilities=probs,
                                                               confidence=confidence)},
                      latency_ms=1.0, source="decisions")


def load_prebuilt(name: str) -> CoachSpec:
    return CoachSpec.model_validate_json((PREBUILT / f"{name}.json").read_text())


def wall() -> float:
    return time.time()
