"""Coach Studio (plan.md 4.7): coach library, builder, validation, personal coach.

FINAL PUBLIC INTERFACE (do not change signatures; add private modules inside backend/studio/):

    async def build_coach(goal: str) -> CoachSpec          # Gemini 3.8 Flash -> validated CoachSpec
    def validate_coach(spec: CoachSpec) -> list[str]       # [] means valid; else human-readable errors
    def load_prebuilt() -> list[CoachSpec]                 # backend/studio/prebuilt/*.json
    def build_personal_coach(profile: HabitProfile) -> CoachSpec   # kind "personal"
    def default_coach() -> CoachSpec                       # always valid, no I/O
    router: APIRouter                                       # routes in backend/studio/routes.py

Extra (additive): `build_coach_with_meta(goal) -> BuildResult` also says how the coach was
produced ("llm" | "repaired" | "fallback") and how long it took.

Coach lookup order used by the brain: db.load_coach(id) -> load_prebuilt() -> default_coach().
"""

from __future__ import annotations

import json
import logging

from pydantic import ValidationError

from backend.config import PREBUILT_COACHES_DIR
from backend.contracts import CoachSpec
from backend.studio.builder import BuildResult, build_coach, build_coach_with_meta
from backend.studio.default import default_coach
from backend.studio.personal import build_personal_coach
from backend.studio.validate import validate_coach

log = logging.getLogger("undertone.studio")

__all__ = ["BuildResult", "build_coach", "build_coach_with_meta", "build_personal_coach",
           "default_coach", "load_prebuilt", "router", "validate_coach"]


def load_prebuilt() -> list[CoachSpec]:
    coaches: list[CoachSpec] = []
    if not PREBUILT_COACHES_DIR.is_dir():
        return coaches
    for path in sorted(PREBUILT_COACHES_DIR.glob("*.json")):
        try:
            spec = CoachSpec.model_validate(json.loads(path.read_text()))
        except (OSError, ValueError, ValidationError) as exc:
            log.warning("skipping invalid prebuilt coach %s: %s", path.name, exc)
            continue
        errs = validate_coach(spec)
        if errs:
            log.warning("skipping prebuilt coach %s: %s", path.name, "; ".join(errs))
            continue
        coaches.append(spec)
    return coaches


from backend.studio.routes import router  # noqa: E402  (routes import the functions above)
