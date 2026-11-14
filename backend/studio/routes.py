"""Studio routes (plan.md 4.11). Stub bodies work; the worker may refine but keep paths/shapes."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.contracts import CoachSpec, HabitProfile
from backend.deps import get_app_state, get_brain
from backend.state import AppState

if TYPE_CHECKING:
    from backend.brain import Brain

router = APIRouter(tags=["studio"])


class BuildRequest(BaseModel):
    goal: str


def _all_coaches(st: AppState) -> list[CoachSpec]:
    from backend import studio

    by_id: dict[str, CoachSpec] = {c.id: c for c in [studio.default_coach(), *studio.load_prebuilt()]}
    by_id.update({c.id: c for c in st.db.list_coaches()})
    return list(by_id.values())


@router.get("/coaches", response_model=list[CoachSpec])
def list_coaches(st: AppState = Depends(get_app_state)) -> list[CoachSpec]:
    return _all_coaches(st)


@router.get("/coaches/{coach_id}.json", response_model=CoachSpec)
def get_coach(coach_id: str, brain: "Brain" = Depends(get_brain)) -> CoachSpec:
    coach = brain.find_coach(coach_id)
    if coach is None:
        raise HTTPException(404, f"coach {coach_id} not found")
    return coach


@router.put("/coaches/{coach_id}", response_model=CoachSpec)
def put_coach(coach_id: str, spec: CoachSpec, st: AppState = Depends(get_app_state)) -> CoachSpec:
    from backend import studio

    if spec.id != coach_id:
        raise HTTPException(400, "body id must match path id")
    errors = studio.validate_coach(spec)
    if errors:
        raise HTTPException(422, "; ".join(errors))
    st.db.save_coach(spec)
    return spec


@router.post("/coaches/build", response_model=CoachSpec)
async def build(req: BuildRequest, st: AppState = Depends(get_app_state)) -> CoachSpec:
    from backend import studio

    spec = await studio.build_coach(req.goal)
    errors = studio.validate_coach(spec)
    if errors:
        raise HTTPException(422, "; ".join(errors))
    st.db.save_coach(spec)
    return spec


@router.post("/coaches/{coach_id}/activate", response_model=CoachSpec)
async def activate(coach_id: str, brain: "Brain" = Depends(get_brain)) -> CoachSpec:
    coach = brain.find_coach(coach_id)
    if coach is None:
        raise HTTPException(404, f"coach {coach_id} not found")
    await brain.activate_coach(coach)
    return coach


@router.post("/coaches/personal", response_model=CoachSpec)
def personal(st: AppState = Depends(get_app_state)) -> CoachSpec:
    from backend import studio

    profile = st.db.load_profile() or HabitProfile()
    spec = studio.build_personal_coach(profile)
    st.db.save_coach(spec)
    return spec
