"""STUB (to be replaced by the builder worker): Gemini goal -> CoachSpec with repair and fallback."""

from __future__ import annotations

import re
import time
from dataclasses import dataclass, field
from typing import Literal

from backend.contracts import CoachSpec
from backend.studio.default import default_coach

BuildSource = Literal["llm", "repaired", "fallback"]


@dataclass(frozen=True)
class BuildResult:
    spec: CoachSpec
    source: BuildSource
    elapsed_ms: float
    notes: list[str] = field(default_factory=list)  # errors seen / fixes applied, for logs and the UI


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:40] or "coach"


async def build_coach_with_meta(goal: str) -> BuildResult:
    t0 = time.perf_counter()
    base = default_coach()
    spec = base.model_copy(update={"id": f"custom-{_slug(goal)}", "name": goal[:60], "goal": goal,
                                   "kind": "custom"})
    return BuildResult(spec, "fallback", (time.perf_counter() - t0) * 1000)


async def build_coach(goal: str) -> CoachSpec:
    return (await build_coach_with_meta(goal)).spec
