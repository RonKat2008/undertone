"""Growth routes (plan.md 4.11). Stub bodies work; keep paths and response shapes."""

from __future__ import annotations

import re
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.contracts import (
    DailyMission, DebriefNumbers, HabitProfile, Person, SessionSummary, Streak, WeeklyReport,
)
from backend.deps import get_app_state
from backend.state import AppState

router = APIRouter(tags=["growth"])


class ChooseMission(BaseModel):
    focus_rule_id: str


class TagPerson(BaseModel):
    name: str
    person_id: str | None = None


@router.get("/profile", response_model=HabitProfile)
def get_profile(st: AppState = Depends(get_app_state)) -> HabitProfile:
    return st.db.load_profile() or HabitProfile()


@router.get("/mission/today", response_model=DailyMission)
def get_mission(st: AppState = Depends(get_app_state)) -> DailyMission:
    from backend import growth

    return growth.mission_for_today(st.db)


@router.post("/mission/choose", response_model=DailyMission)
def choose_mission(body: ChooseMission, st: AppState = Depends(get_app_state)) -> DailyMission:
    from backend import growth

    current = growth.mission_for_today(st.db)
    pick = next((s for s in current.suggestions if s.focus_rule_id == body.focus_rule_id), None)
    if pick is None and body.focus_rule_id != current.focus_rule_id:
        raise HTTPException(400, f"{body.focus_rule_id} is not one of today's suggestions")
    chosen = current if pick is None else current.model_copy(
        update={"focus_rule_id": pick.focus_rule_id, "text": pick.text, "progress": 0, "done": False})
    st.db.save_mission(chosen)
    return chosen


@router.get("/streak", response_model=Streak)
def get_streak(st: AppState = Depends(get_app_state)) -> Streak:
    from backend import growth

    return growth.streak(st.db)


@router.get("/report/weekly", response_model=WeeklyReport)
def weekly(st: AppState = Depends(get_app_state)) -> WeeklyReport:
    sessions = st.db.list_sessions(limit=50)
    return WeeklyReport(week_of=date.today().isoformat(), trend=[],
                        best_session_id=sessions[0]["session_id"] if sessions else None,
                        biggest_improvement="Not enough sessions yet.")


@router.get("/people", response_model=list[Person])
def people(st: AppState = Depends(get_app_state)) -> list[Person]:
    return st.db.list_people()


@router.post("/sessions/{session_id}/person", response_model=Person)
def tag_person(session_id: str, body: TagPerson, st: AppState = Depends(get_app_state)) -> Person:
    if st.db.get_session(session_id) is None:
        raise HTTPException(404, f"session {session_id} not found")
    pid = body.person_id or re.sub(r"[^a-z0-9]+", "-", body.name.lower()).strip("-") or "person"
    existing = next((p for p in st.db.list_people() if p.person_id == pid), None)
    person = (existing or Person(person_id=pid, name=body.name)).model_copy(
        update={"sessions": (existing.sessions if existing else 0) + 1})
    st.db.save_person(person)
    st.db.set_session_person(session_id, pid)
    return person


@router.get("/sessions", response_model=list[SessionSummary])
def sessions(st: AppState = Depends(get_app_state)) -> list[SessionSummary]:
    out: list[SessionSummary] = []
    for row in st.db.list_sessions():
        if row.get("summary_json"):
            out.append(SessionSummary.model_validate_json(row["summary_json"]))
            continue
        out.append(SessionSummary(
            session_id=row["session_id"], started_at=row["started_at"], duration_s=row["duration_s"] or 0,
            coach_name=row["coach_name"], mode=row["mode"], person_id=row["person_id"],
            headline_fact="(in progress)" if not row["ended_at"] else "",
            numbers=DebriefNumbers(talk_ratio=0, interruptions=0, questions=0, fillers_per_min=0, wpm=0)))
    return out
