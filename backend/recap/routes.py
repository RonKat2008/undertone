"""Day recap routes, mounted under /reports in backend/main.py."""


from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.contracts import DayRecap
from backend.deps import get_app_state
from backend.recap import _day
from backend.recap._build import day_recap
from backend.state import AppState

router = APIRouter(tags=["reports"])

DateQ = Query(None, description="local day YYYY-MM-DD; default today")
TzQ = Query(None, max_length=64, description="IANA zone, e.g. America/Los_Angeles; default the machine's")


def _args(date_: str | None, tz: str | None) -> tuple[date | None, _day.Zone]:
    try:
        zone = _day.parse_zone(tz) if tz else _day.local_zone()
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if date_ is None:
        return None, zone
    try:
        return date.fromisoformat(date_), zone
    except ValueError as exc:
        raise HTTPException(422, f"date must be YYYY-MM-DD, got {date_!r}") from exc


@router.get("/day", response_model=DayRecap)
async def get_day(date: str | None = DateQ, tz: str | None = TzQ,
                  st: AppState = Depends(get_app_state)) -> DayRecap:
    day, zone = _args(date, tz)
    return await day_recap(st.db, day, zone)


@router.post("/day/refresh", response_model=DayRecap)
async def refresh_day(date: str | None = DateQ, tz: str | None = TzQ,
                      st: AppState = Depends(get_app_state)) -> DayRecap:
    day, zone = _args(date, tz)
    return await day_recap(st.db, day, zone, refresh=True)
