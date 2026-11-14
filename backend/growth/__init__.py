"""Growth (plan.md 4.0, 4.9): habit profile, daily mission, streak, history, people, weekly report.

FINAL PUBLIC INTERFACE (do not change signatures; private modules live inside backend/growth/):

    def update_profile(db: DB, session: SessionState, metrics: Metrics) -> HabitProfile
        # called by brain after each debrief; persists and returns the new profile
    def mission_for_today(db: DB) -> DailyMission     # creates + stores today's if missing
    def streak(db: DB) -> Streak
    def current_profile(db: DB) -> HabitProfile       # stored profile, or an empty one
    def focus_rates(db: DB, coach_id: str, rule_id: str, limit: int = 3) -> list[float]
        # the focus rule's firing rate (buzzed + quiet, per wearer minute) for the last finished
        # regular sessions with that coach, oldest to newest (input to nudge.next_policy)
    def next_session_index(db: DB) -> int             # 1-based index of the session about to start
    router: APIRouter   # backend/growth/routes.py:
        GET /profile, GET /mission/today, POST /mission/choose, GET /streak, GET /report/weekly,
        GET /people, POST /sessions/{id}/person, GET /sessions

Everything is deterministic maths over stored (finished) sessions:
    _store.py    reads sessions, turns, nudges (loud + quiet), debriefs into StoredSession
    _profile.py  baselines, crutch words, recurring issues with trends
    _mission.py  one mission per UTC day, learning goal early, +15% target later, choice
    _streak.py   practice days, one freeze, no broken-streak wording
    _report.py   weekly trend against the wearer's own baseline
    _people.py   person cards (own behaviour with them vs own average) and tagging
    _fading.py   focus-rule firing rates and session index for the fading policy
    _writer.py / _sample.py   writing sessions for tests and scripts/seed_sample.py
"""

from __future__ import annotations

from backend.contracts import DailyMission, HabitProfile, Metrics, Streak
from backend.db import DB
from backend.growth import _fading, _mission, _profile, _streak
from backend.state import SessionState

__all__ = ["current_profile", "focus_rates", "mission_for_today", "next_session_index", "router", "streak",
           "update_profile"]


def update_profile(db: DB, session: SessionState, metrics: Metrics) -> HabitProfile:
    """Recompute the profile from every stored session (the just-ended one included)."""
    del metrics  # the ended session's metrics are already stored by brain.py before this call
    return _profile.rebuild_profile(db, session.coach.filler_words)


def mission_for_today(db: DB) -> DailyMission:
    return _mission.mission_today(db)


def streak(db: DB) -> Streak:
    return _streak.streak_for(db)


def current_profile(db: DB) -> HabitProfile:
    """The stored habit profile, or an empty one before the first finished session."""
    return db.load_profile() or HabitProfile()


def focus_rates(db: DB, coach_id: str, rule_id: str, limit: int = _fading.FADE_HISTORY) -> list[float]:
    return _fading.focus_rates(db, coach_id, rule_id, limit)


def next_session_index(db: DB) -> int:
    return _fading.next_session_index(db)


from backend.growth.routes import router  # noqa: E402
