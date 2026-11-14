"""Builds the condition env the rules read: judge.*, metrics.*, motion.*."""

from __future__ import annotations

from typing import Any

from backend.contracts import JudgeEvent, Metrics, MotionSnapshot


def build_env(judge: JudgeEvent | None, metrics: Metrics, motion_state: MotionSnapshot | None) -> dict[str, Any]:
    return {
        "judge": {k: v.model_dump() for k, v in judge.results.items()} if judge else {},
        "metrics": metrics.model_dump(),
        "motion": motion_state.model_dump() if motion_state else {},
    }
