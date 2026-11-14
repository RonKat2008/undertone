"""Inputs for the fading nudge policy (plan.md 4.0/4.5): the focus rule's recent firing rates
and the 1-based index of the upcoming session. Pure reads; all queries are parameterised."""

from __future__ import annotations

from backend.db import DB
from backend.growth._store import StoredSession, _from_row

FADE_HISTORY = 3  # nudge.policy.next_policy looks at the last 3 rates


def firing_rate(session: StoredSession, rule_id: str) -> float:
    """Fires of one rule (buzzed + quiet) per minute of the wearer's speech."""
    return round(session.fired(rule_id) / session.minutes, 4)


def focus_rates(db: DB, coach_id: str, rule_id: str, limit: int = FADE_HISTORY) -> list[float]:
    """Firing rates of `rule_id` over the last `limit` finished regular sessions with this coach,
    oldest to newest."""
    rows = db.query(
        "SELECT * FROM sessions WHERE ended_at IS NOT NULL AND mode = 'regular' AND coach_id = ? "
        "ORDER BY started_at DESC LIMIT ?", (coach_id, limit))
    newest_first = [_from_row(db, dict(r)) for r in rows]
    return [firing_rate(s, rule_id) for s in reversed(newest_first)]


def next_session_index(db: DB) -> int:
    """1-based index of the session about to start: finished sessions so far, plus this one."""
    rows = db.query("SELECT COUNT(*) AS n FROM sessions WHERE ended_at IS NOT NULL")
    return int(rows[0]["n"]) + 1
