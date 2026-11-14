"""Coach Studio routes (plan.md 4.11).

Studio functions are looked up on the `backend.studio` package inside each handler (this module
is imported at the bottom of `backend/studio/__init__.py`, so a top-level import would cycle, and
the lookup keeps them patchable in tests).

Error shapes (all main.py's envelope):
- coach/goal problems (422, or 500 if the builder ever returns an invalid coach):
  `{"ok": false, "error": {"code": "invalid_coach"|"invalid_goal"|"invalid_built_coach",
  "message": "<errors joined by '; '>", "details": {"errors": [str]}}}`
- id mismatch 400 / unknown coach 404: `{"ok": false, "error": {"code": "http_4xx", "message"}}`
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.contracts import CoachSpec, HabitProfile
from backend.deps import get_app_state, get_brain
from backend.state import AppState

if TYPE_CHECKING:
    from backend.brain import Brain

log = logging.getLogger("undertone.studio.routes")

router = APIRouter(tags=["studio"])

MAX_GOAL_CHARS = 300


class BuildRequest(BaseModel):
    goal: str


class BuildResponse(BaseModel):
    spec: CoachSpec
    source: Literal["llm", "repaired", "fallback"]
    elapsed_ms: float
    notes: list[str]


def _errors(status: int, code: str, errors: list[str]) -> HTTPException:
    """main.py turns this into {"ok": false, "error": {code, message, "details": {"errors": [...]}}}."""
    return HTTPException(status, {"code": code, "message": "; ".join(errors), "errors": errors})


def _all_coaches(st: AppState) -> list[CoachSpec]:
    from backend import studio

    by_id: dict[str, CoachSpec] = {c.id: c for c in [studio.default_coach(), *studio.load_prebuilt()]}
    by_id.update({c.id: c for c in st.db.list_coaches()})  # saved coaches win
    return list(by_id.values())


def _goal_errors(goal: str) -> list[str]:
    if not goal:
        return ["goal is empty; describe what you want to practise"]
    if len(goal) > MAX_GOAL_CHARS:
        return [f"goal is {len(goal)} chars; keep it to {MAX_GOAL_CHARS} or fewer"]
    return []


@router.get("/coaches", response_model=list[CoachSpec])
def list_coaches(st: AppState = Depends(get_app_state)) -> list[CoachSpec]:
    return _all_coaches(st)


@router.get("/coaches/{coach_id}.json", response_model=CoachSpec)
def get_coach(coach_id: str, brain: "Brain" = Depends(get_brain)) -> CoachSpec:
    coach = brain.find_coach(coach_id)
    if coach is None:
        raise HTTPException(404, f"coach {coach_id!r} not found")
    return coach


@router.put("/coaches/{coach_id}", response_model=CoachSpec)
def put_coach(coach_id: str, spec: CoachSpec,
              st: AppState = Depends(get_app_state)) -> CoachSpec:
    from backend import studio

    if spec.id != coach_id:
        raise HTTPException(400, f"body id {spec.id!r} does not match path id {coach_id!r}")
    errors = studio.validate_coach(spec)
    if errors:
        raise _errors(422, "invalid_coach", errors)
    st.db.save_coach(spec)
    return spec


@router.post("/coaches/build", response_model=BuildResponse)
async def build(req: BuildRequest,
                st: AppState = Depends(get_app_state)) -> BuildResponse:
    from backend import studio

    goal = req.goal.strip()  # untrusted text: only ever handed to the builder
    goal_errors = _goal_errors(goal)
    if goal_errors:
        raise _errors(422, "invalid_goal", goal_errors)
    result = await studio.build_coach_with_meta(goal)
    errors = studio.validate_coach(result.spec)
    if errors:  # the builder guarantees a valid spec; this should never happen
        log.error("builder returned an invalid coach (%s): %s", result.source, "; ".join(errors))
        raise _errors(500, "invalid_built_coach", errors)
    st.db.save_coach(result.spec)
    return BuildResponse(spec=result.spec, source=result.source, elapsed_ms=result.elapsed_ms,
                         notes=list(result.notes))


@router.post("/coaches/personal", response_model=CoachSpec)
def personal(st: AppState = Depends(get_app_state)) -> CoachSpec:
    from backend import studio

    profile = st.db.load_profile() or HabitProfile()
    spec = studio.build_personal_coach(profile)
    st.db.save_coach(spec)
    return spec


@router.post("/coaches/{coach_id}/activate", response_model=CoachSpec)
async def activate(coach_id: str, brain: "Brain" = Depends(get_brain)) -> CoachSpec:
    coach = brain.find_coach(coach_id)
    if coach is None:
        raise HTTPException(404, f"coach {coach_id!r} not found")
    await brain.activate_coach(coach)
    return coach
