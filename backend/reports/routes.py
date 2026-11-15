"""Report routes. Thin: load both windows once, call one pure report function. Never call the LLM,
never schedule background work, never write."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.contracts import (
    ByPersonReport, ByTopicReport, HabitsReport, OverviewReport, PersonReport, PromisesReport, TopicReport,
)
from backend.deps import get_app_state
from backend.reports._habits import habits_report
from backend.reports._input import ReportInput, load_report_input
from backend.reports._overview import overview_report
from backend.reports._people import by_person_report, known_person_ids, parse_person_id, person_report
from backend.reports._promises import promises_report
from backend.reports._topics import by_topic_report, parse_topic_id, topic_label, topic_report
from backend.state import AppState

router = APIRouter(prefix="/reports", tags=["reports"])

DEFAULT_DAYS = 30
MAX_DAYS = 365
Days = Query(DEFAULT_DAYS, ge=1, le=MAX_DAYS, description="window length in UTC days, including today")


def _input(st: AppState, days: int) -> ReportInput:
    return load_report_input(st.db, days, time.time())


@router.get("/overview", response_model=OverviewReport)
def get_overview(days: int = Days, st: AppState = Depends(get_app_state)) -> OverviewReport:
    return overview_report(_input(st, days))


@router.get("/by-person", response_model=ByPersonReport)
def get_by_person(days: int = Days, st: AppState = Depends(get_app_state)) -> ByPersonReport:
    return by_person_report(_input(st, days))


@router.get("/person/{person_id}", response_model=PersonReport)
def get_person(person_id: str, days: int = Days, st: AppState = Depends(get_app_state)) -> PersonReport:
    """`person_id` or `person:<id>`. 404 when the person is neither in the people store nor tagged on a
    conversation of this or the previous window; a known person with no conversations gives zeros."""
    inp = _input(st, days)
    pid = parse_person_id(person_id)
    if pid not in known_person_ids(inp):
        raise HTTPException(404, f"person {person_id} not found")
    return person_report(inp, pid)


@router.get("/by-topic", response_model=ByTopicReport)
def get_by_topic(days: int = Days, st: AppState = Depends(get_app_state)) -> ByTopicReport:
    return by_topic_report(_input(st, days))


@router.get("/topic/{topic_id}", response_model=TopicReport)
def get_topic(topic_id: str, days: int = Days, st: AppState = Depends(get_app_state)) -> TopicReport:
    """`<slug>` or `topic:<slug>`. 404 when the topic is in neither this nor the previous window."""
    inp = _input(st, days)
    slug = parse_topic_id(topic_id)
    label = topic_label(inp, slug)
    if label is None:
        raise HTTPException(404, f"topic {topic_id} not found")
    return topic_report(inp, slug, label)


@router.get("/habits", response_model=HabitsReport)
def get_habits(days: int = Days, st: AppState = Depends(get_app_state)) -> HabitsReport:
    return habits_report(_input(st, days))


@router.get("/promises", response_model=PromisesReport)
def get_promises(days: int = Days, st: AppState = Depends(get_app_state)) -> PromisesReport:
    return promises_report(_input(st, days))
