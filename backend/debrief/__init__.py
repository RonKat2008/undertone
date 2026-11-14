"""Debrief (plan.md 4.6): three-beat recap, notes, bookmark review, timeline, spoken audio.

FINAL PUBLIC INTERFACE (do not change signatures; add private modules inside backend/debrief/):

    async def generate_debrief(session: SessionState, metrics: Metrics,
                               timeline: list[TimelinePoint], last: SessionSummary | None) -> Debrief
        # Never raises: on Gemini failure return a local, numbers-based debrief.
    async def speak(text: str, session_id: str) -> str | None
        # Deepgram Aura-2 -> MP3 saved at MEDIA_DIR / f"{session_id}.mp3"; returns
        # "/media/{session_id}.mp3", or None on failure / no key. Max 2000 chars.
    def spoken_text(debrief: Debrief) -> str   # the ~20 s script, in contract order
    router: APIRouter                          # GET /sessions/{id}/debrief

Private modules:
    wire.py      DebriefDraft: the language-only shape asked of the LLM (no numbers, no timeline)
    prompt.py    build_prompt(session, metrics, last, reasons)
    rules.py     check_draft (wording rules), verify_quote, headline evidence
    local.py     numbers, bookmark snippets, assemble(draft -> Debrief), fallback_debrief
    generate.py  one LLM call -> check -> one retry with reasons -> local fallback
    speech.py    say_numbers, spoken_text, speak (Deepgram)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.contracts import Debrief, Metrics, SessionSummary, TimelinePoint
from backend.debrief import generate as _generate
from backend.debrief import speech as _speech
from backend.deps import get_app_state
from backend.state import AppState, SessionState

__all__ = ["generate_debrief", "router", "speak", "spoken_text"]

router = APIRouter(tags=["debrief"])


async def generate_debrief(session: SessionState, metrics: Metrics, timeline: list[TimelinePoint],
                           last: SessionSummary | None) -> Debrief:
    return await _generate.generate_debrief(session, metrics, timeline, last)


def spoken_text(debrief: Debrief) -> str:
    return _speech.spoken_text(debrief)


async def speak(text: str, session_id: str) -> str | None:
    return await _speech.speak(text, session_id)


@router.get("/sessions/{session_id}/debrief")
def get_debrief(session_id: str, st: AppState = Depends(get_app_state)) -> dict:
    found = st.db.load_debrief(session_id)
    if found is None:
        raise HTTPException(404, f"no debrief for {session_id}")
    debrief, audio_url = found
    return {"session_id": session_id, "data": debrief.model_dump(mode="json"), "audio_url": audio_url}
