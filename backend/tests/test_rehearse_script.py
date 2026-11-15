"""scripts/rehearse.py taps "How am I doing?" after the fast answer, as in plan.md section 9."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from backend.contracts import NudgeEvent, TurnFinalEvent

ROOT = Path(__file__).resolve().parents[2]


def _rehearse():
    spec = importlib.util.spec_from_file_location("rehearse_script", ROOT / "scripts" / "rehearse.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _turn(tid: str, speaker: str) -> TurnFinalEvent:
    return TurnFinalEvent(turn_id=tid, speaker=speaker, text="x", start=0, end=1, wpm=150, fillers=[])  # type: ignore[arg-type]


def _nudge(haptic: str) -> NudgeEvent:
    return NudgeEvent(rule_id="r", haptic=haptic, message="m", reason="r", confidence=None,  # type: ignore[arg-type]
                      latency_ms=0, budget_left=1, ts=1)


def test_tap_waits_for_wearer_turn_after_pace_buzz() -> None:
    done = _rehearse().fast_answer_done
    assert not done([_turn("t1", "me")])
    assert not done([_turn("t1", "me"), _nudge("filler"), _turn("t2", "me")])
    assert not done([_nudge("slow_down"), _turn("t2", "other")])
    assert done([_turn("t1", "me"), _nudge("slow_down"), _turn("t2", "other"), _turn("t3", "me")])
