"""Growth (plan.md 4.9): habit profile, daily mission, streak, history, people, weekly report.

FINAL PUBLIC INTERFACE (do not change signatures; add private modules inside backend/growth/):

    def update_profile(db: DB, session: SessionState, metrics: Metrics) -> HabitProfile
        # called by brain after each debrief; persists and returns the new profile
    def mission_for_today(db: DB) -> DailyMission     # creates + stores today's if missing
    def streak(db: DB) -> Streak
    router: APIRouter   # backend/growth/routes.py:
        GET /profile, GET /mission/today, POST /mission/choose, GET /streak, GET /report/weekly,
        GET /people, POST /sessions/{id}/person, GET /sessions

STUB: simple counts and a fixed mission; the worker adds trends, mission maths and wording.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

from backend.contracts import (
    CrutchWord, DailyMission, HabitProfile, Metrics, MissionSuggestion, Streak,
)
from backend.db import DB
from backend.state import SessionState

__all__ = ["mission_for_today", "router", "streak", "update_profile"]


def _running_mean(old: float | None, new: float, n: int) -> float:
    return new if old is None or n <= 1 else round(old + (new - old) / n, 2)


def update_profile(db: DB, session: SessionState, metrics: Metrics) -> HabitProfile:
    old = db.load_profile() or HabitProfile()
    n = old.sessions + 1
    minutes = max(session.duration_s / 60, 1 / 60)
    counts: dict[str, int] = {}
    for turn in session.turns:
        if turn.speaker == "me":
            for f in turn.fillers:
                counts = {**counts, f: counts.get(f, 0) + 1}
    crutch = sorted((CrutchWord(word=w, per_min=round(c / minutes, 2)) for w, c in counts.items()),
                    key=lambda c: -c.per_min)[:5]
    profile = HabitProfile(
        sessions=n,
        baseline_wpm=_running_mean(old.baseline_wpm, metrics.wpm, n) if metrics.wpm else old.baseline_wpm,
        baseline_volume_db=old.baseline_volume_db,
        crutch_words=crutch or old.crutch_words,
        recurring_issues=old.recurring_issues,
    )
    db.save_profile(profile)
    return profile


def _default_mission(today: str) -> DailyMission:
    return DailyMission(
        date=today, focus_rule_id="monologue",
        text="Ask 3 open questions before your second story.",
        if_then="When you finish a point, ask a how or what question.",
        target=3, progress=0, done=False,
        suggestions=[
            MissionSuggestion(focus_rule_id="interrupt", text="Let them finish every sentence today."),
            MissionSuggestion(focus_rule_id="filler", text="Replace 'like' with a pause in one meeting."),
        ],
    )


def mission_for_today(db: DB) -> DailyMission:
    today = date.today().isoformat()
    found = db.load_mission(today)
    if found is not None:
        return found
    mission = _default_mission(today)
    db.save_mission(mission)
    return mission


def streak(db: DB) -> Streak:
    days_with = {s["started_at"][:10] for s in db.list_sessions(limit=500)}
    today = datetime.now(timezone.utc).date()
    week = [(today - timedelta(days=6 - i)).isoformat() in days_with for i in range(7)]
    run = 0
    d = today
    while d.isoformat() in days_with:
        run += 1
        d -= timedelta(days=1)
    return Streak(days=run, freeze_available=True, week=week)


from backend.growth.routes import router  # noqa: E402
