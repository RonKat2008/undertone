"""After speaker labels are corrected: recompute the stored numbers that depend on who spoke.

Recomputed (from the corrected turns, with the same MetricsEngine the live session used):
    sessions.metrics_json   talk_ratio, wpm, fillers_per_min, monologue_s
    sessions.summary_json   numbers.talk_ratio, numbers.wpm, numbers.fillers_per_min
    habit profile           rebuilt (it reads the wearer's stored turns)
    people cards            rebuilt (they read the summaries)
Not recomputed: interruptions and questions (they come from live judge results on the turns
judged as the wearer's at the time), volume and hand energy, the debrief text and its numbers,
judge results, and nudges or haptics that already fired. The report says so per session.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from typing import Any

from backend.contracts import Metrics, SessionSummary, TurnFinalEvent
from backend.db import DB

log = logging.getLogger("undertone.voices")

RECOMPUTED: tuple[str, ...] = ("talk_ratio", "wpm", "fillers_per_min", "monologue_s")
SUMMARY_FIELDS: tuple[str, ...] = ("talk_ratio", "wpm", "fillers_per_min")
NOT_RECOMPUTED: tuple[str, ...] = (
    "interruptions", "questions", "volume", "hand_energy", "debrief text and numbers", "judge results",
    "nudges already fired",
)


def speaker_metrics(turns: Sequence[TurnFinalEvent], duration_s: float, filler_words: Sequence[str]) -> Metrics:
    """Pure-ish: the speaker-dependent numbers for a finished conversation."""
    from backend.metrics import MetricsEngine  # noqa: PLC0415 - heavy import, only when needed

    engine = MetricsEngine(None, None, list(filler_words))
    for t in sorted(turns, key=lambda t: (t.start, t.end)):
        engine.add_turn(t)
    end = max([duration_s, *(t.end for t in turns)] or [0.0])
    return engine.snapshot(end)


def merged_metrics(old: Metrics | None, new: Metrics) -> Metrics:
    base = old or Metrics()
    return base.model_copy(update={k: getattr(new, k) for k in RECOMPUTED})


def merged_summary(old: SessionSummary, new: Metrics) -> SessionSummary:
    numbers = old.numbers.model_copy(update={k: round(float(getattr(new, k)), 3) for k in SUMMARY_FIELDS})
    return old.model_copy(update={"numbers": numbers})


def _parse(model: Any, raw: str | None) -> Any:
    if not raw:
        return None
    try:
        return model.model_validate_json(raw)
    except ValueError:
        return None


def recompute_session(db: DB, session_id: str, turns: Sequence[TurnFinalEvent],
                      filler_words: Sequence[str]) -> list[str]:
    """Rewrite the speaker-dependent stored numbers. Returns what was rewritten."""
    row = db.get_session(session_id)
    if row is None or row.get("ended_at") is None:
        return []
    new = speaker_metrics(turns, float(row.get("duration_s") or 0.0), filler_words)
    done: list[str] = []
    old_metrics = _parse(Metrics, row.get("metrics_json"))
    metrics = merged_metrics(old_metrics, new)
    db.execute("UPDATE sessions SET metrics_json = ? WHERE session_id = ?",
               (metrics.model_dump_json(by_alias=True), session_id))
    done.append("metrics")
    summary = _parse(SessionSummary, row.get("summary_json"))
    if summary is not None:
        db.execute("UPDATE sessions SET summary_json = ? WHERE session_id = ?",
                   (merged_summary(summary, new).model_dump_json(by_alias=True), session_id))
        done.append("summary")
    return done


def rebuild_derived(db: DB, filler_words: Sequence[str]) -> list[str]:
    """Habit profile and people cards. Never raises."""
    done: list[str] = []
    try:
        from backend.growth._profile import rebuild_profile  # noqa: PLC0415

        rebuild_profile(db, filler_words)
        done.append("profile")
    except Exception:  # noqa: BLE001
        log.exception("voice memory: profile rebuild failed")
    try:
        refresh_people(db)
        done.append("people")
    except Exception:  # noqa: BLE001
        log.exception("voice memory: people cards refresh failed")
    return done


def refresh_people(db: DB) -> None:
    from backend.growth._people import person_cards  # noqa: PLC0415
    from backend.growth._store import load_sessions  # noqa: PLC0415

    for card in person_cards(load_sessions(db), db.list_people()):
        db.save_person(card)
