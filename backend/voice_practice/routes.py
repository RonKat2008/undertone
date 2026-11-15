"""WS /ws/practice and GET /practice/results, /practice/results/{id}, /practice/goals."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, WebSocket

from backend.config import load_settings
from backend.contracts import PracticeGoals, PracticeResult, PracticeResultSummary
from backend.deps import get_app_state
from backend.state import AppState
from backend.voice_practice import store
from backend.voice_practice.relay import PracticeDeps, PracticeSession

log = logging.getLogger("undertone.voice_practice")
router = APIRouter()


@router.get("/practice/results", response_model=list[PracticeResultSummary])
def list_practice_results(limit: int = 50, st: AppState = Depends(get_app_state)) -> list[PracticeResultSummary]:
    return store.list_results(st.db, max(1, min(limit, 200)))


@router.get("/practice/results/{result_id}", response_model=PracticeResult)
def get_practice_result(result_id: str, st: AppState = Depends(get_app_state)) -> PracticeResult:
    found = store.load_result(st.db, result_id)
    if found is None:
        raise HTTPException(404, "practice result not found")
    return found


@router.get("/practice/goals", response_model=PracticeGoals)
def get_practice_goals(st: AppState = Depends(get_app_state)) -> PracticeGoals:
    return store.current_goals(st.db)


def build_deps(st: AppState) -> PracticeDeps:
    """Everything one practice needs, read once at its start."""
    previous = store.current_goals(st.db).goals
    try:
        profile = st.db.load_profile()
    except Exception:  # noqa: BLE001 - habits are a nice-to-have for the questions
        log.warning("practice: habit profile unreadable, asking without it")
        profile = None
    return PracticeDeps(key=load_settings().deepgram_api_key, coach=st.active_coach, profile=profile,
                        previous_goals=tuple(previous), save=lambda result: store.save_result(st.db, result))


@router.websocket("/ws/practice")
async def practice_socket(websocket: WebSocket) -> None:
    st: AppState | None = getattr(websocket.app.state, "app", None)
    await websocket.accept()
    if st is None:
        await websocket.send_json({"type": "practice.error", "code": "agent_refused",
                                   "message": "The backend is still starting. Try again in a moment."})
        await websocket.close()
        return
    await PracticeSession(websocket, build_deps(st)).run()  # type: ignore[arg-type]
