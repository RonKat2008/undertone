"""Growth routes (plan.md 4.11). Thin HTTP layer over the pure growth modules."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.contracts import (
    DailyMission, DebriefNumbers, HabitProfile, Person, SessionSummary, Streak, WeeklyReport,
)
from backend.deps import get_app_state
from backend.growth import _mission, _people, _profile, _report, _streak
from backend.growth._store import load_sessions
from backend.state import AppState

log = logging.getLogger(__name__)

router = APIRouter(tags=["growth"])


class ChooseMission(BaseModel):
    focus_rule_id: str = Field(min_length=1, max_length=64)


class TagPerson(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    person_id: str | None = Field(default=None, max_length=80)


@router.get("/profile", response_model=HabitProfile)
def get_profile(st: AppState = Depends(get_app_state)) -> HabitProfile:
    return st.db.load_profile() or _profile.compute_profile(load_sessions(st.db))


@router.get("/mission/today", response_model=DailyMission)
def get_mission(st: AppState = Depends(get_app_state)) -> DailyMission:
    return _mission.mission_today(st.db)


@router.post("/mission/choose", response_model=DailyMission)
def choose_mission(body: ChooseMission, st: AppState = Depends(get_app_state)) -> DailyMission:
    try:
        return _mission.choose_today(st.db, body.focus_rule_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/streak", response_model=Streak)
def get_streak(st: AppState = Depends(get_app_state)) -> Streak:
    return _streak.streak_for(st.db)


@router.get("/report/weekly", response_model=WeeklyReport)
def weekly(st: AppState = Depends(get_app_state)) -> WeeklyReport:
    return _report.report_for(st.db)


@router.get("/people", response_model=list[Person])
def people(st: AppState = Depends(get_app_state)) -> list[Person]:
    return _people.people_for(st.db)


@router.post("/sessions/{session_id}/person", response_model=Person)
def tag_person(session_id: str, body: TagPerson, st: AppState = Depends(get_app_state)) -> Person:
    try:
        return _people.tag_session(st.db, session_id, body.name, body.person_id)
    except LookupError as exc:
        raise HTTPException(404, f"session {session_id} not found") from exc
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc


def _summary(row: dict[str, object]) -> SessionSummary | None:
    raw = row.get("summary_json")
    if isinstance(raw, str) and raw:
        try:
            stored = SessionSummary.model_validate_json(raw)
        except ValueError:
            log.warning("unreadable summary for session %s", row.get("session_id"))
        else:
            # person tags are added after the summary was written; the column is the truth
            return stored.model_copy(update={"person_id": row.get("person_id")})
    return SessionSummary(
        session_id=str(row["session_id"]), started_at=str(row["started_at"]),
        duration_s=float(row["duration_s"] or 0),  # type: ignore[arg-type]
        coach_name=str(row["coach_name"]), mode=row["mode"],  # type: ignore[arg-type]
        person_id=row["person_id"],  # type: ignore[arg-type]
        headline_fact="(in progress)" if not row["ended_at"] else "",
        numbers=DebriefNumbers(talk_ratio=0, interruptions=0, questions=0, fillers_per_min=0, wpm=0))


@router.get("/sessions", response_model=list[SessionSummary])
def sessions(limit: int = Query(50, ge=1, le=500),
             st: AppState = Depends(get_app_state)) -> list[SessionSummary]:
    """Newest first."""
    out = (_summary(row) for row in st.db.list_sessions(limit=limit))
    return [s for s in out if s is not None]
