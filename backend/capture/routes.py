"""Transcript, recording and keep-override routes.

    GET  /sessions/{id}/transcript -> SessionTranscript (404 unknown session)
    GET  /sessions/{id}/audio      -> audio/wav with HTTP Range support (404 when none)
    POST /sessions/{id}/keep       {"kept": bool} -> SessionSummary (the user's override)

Session ids are looked up in the database first; the file path is built from the stored id.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.capture.media import recordings_dir
from backend.capture.store import session_audio_path, session_audio_url
from backend.capture.verdict import KeptReason
from backend.contracts import SessionSummary, SessionTranscript, TranscriptTurn, TurnFinalEvent
from backend.db import DB
from backend.deps import get_app_state
from backend.state import AppState

log = logging.getLogger("undertone.capture")

router = APIRouter(tags=["capture"])


class KeepBody(BaseModel):
    kept: bool


def media_dir(db: DB) -> Path:
    return recordings_dir(Path(db.path))


def _row(db: DB, session_id: str) -> dict[str, Any]:
    row = db.get_session(session_id)
    if row is None:
        raise HTTPException(404, f"session {session_id} not found")
    return row


def to_transcript_turn(turn: TurnFinalEvent) -> TranscriptTurn:
    return TranscriptTurn(turn_id=turn.turn_id, speaker=turn.speaker, text=turn.text, start=turn.start,
                          end=turn.end, wpm=turn.wpm, fillers=list(turn.fillers))


def build_transcript(row: dict[str, Any], turns: list[TurnFinalEvent], url: str | None) -> SessionTranscript:
    """Pure: the transcript payload for one session row."""
    ordered = sorted(turns, key=lambda t: (t.start, t.end))
    offset = float(row.get("audio_offset_s") or 0.0) if url else 0.0
    duration = row.get("duration_s") if row.get("ended_at") else None
    return SessionTranscript(
        session_id=str(row["session_id"]), started_at=str(row["started_at"]),
        duration_s=None if duration is None else float(duration), audio_url=url, audio_offset_s=offset,
        turns=[to_transcript_turn(t) for t in ordered])


def override_reason(kept: bool, previous: str | None) -> KeptReason:
    """The user's call: kept -> 'keep'; not kept keeps a more specific earlier reason."""
    if kept:
        return "keep"
    return previous if previous in ("trivial", "noise", "sensitive") else "trivial"  # type: ignore[return-value]


@router.get("/sessions/{session_id}/transcript", response_model=SessionTranscript)
def get_transcript(session_id: str, st: AppState = Depends(get_app_state)) -> SessionTranscript:
    row = _row(st.db, session_id)
    return build_transcript(row, st.db.load_turns(session_id), session_audio_url(row, media_dir(st.db)))


@router.get("/sessions/{session_id}/audio")
def get_audio(session_id: str, st: AppState = Depends(get_app_state)) -> FileResponse:
    row = _row(st.db, session_id)
    path = session_audio_path(row, media_dir(st.db))
    if path is None:
        raise HTTPException(404, f"no recording for {session_id}")
    return FileResponse(path, media_type="audio/wav", filename=f"{row['session_id']}.wav",
                        content_disposition_type="inline")


@router.post("/sessions/{session_id}/keep", response_model=SessionSummary)
def set_keep(session_id: str, body: KeepBody, st: AppState = Depends(get_app_state)) -> SessionSummary:
    from backend.growth.routes import summary_for_row  # growth imports nothing from here

    row = _row(st.db, session_id)
    reason = override_reason(body.kept, row.get("kept_reason"))
    st.db.set_verdict(session_id, body.kept, reason, "user")
    _rebuild_profile(st)
    summary = summary_for_row(st.db.get_session(session_id) or row, media_dir(st.db))
    if summary is None:
        raise HTTPException(500, "could not read the session back")
    return summary


def _rebuild_profile(st: AppState) -> None:
    """Kept sessions feed the habit profile: recompute it after a change. Never raises."""
    try:
        from backend.growth._profile import rebuild_profile

        rebuild_profile(st.db, st.active_coach.filler_words)
    except Exception:  # noqa: BLE001
        log.exception("profile rebuild after keep override failed")
