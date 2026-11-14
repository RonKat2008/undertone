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

STUB: local template debrief from the numbers; speak returns None.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.contracts import (
    BookmarkReview, Debrief, DebriefNumbers, Metrics, SessionSummary, TimelinePoint,
)
from backend.deps import get_app_state
from backend.state import AppState, SessionState

__all__ = ["generate_debrief", "router", "speak", "spoken_text"]

router = APIRouter(tags=["debrief"])


def _numbers(m: Metrics) -> DebriefNumbers:
    return DebriefNumbers(talk_ratio=m.talk_ratio, interruptions=m.interruptions, questions=m.questions,
                          fillers_per_min=m.fillers_per_min, wpm=m.wpm)


def _snippet(session: SessionState, ts: float) -> str:
    near = [t for t in session.turns if t.start - 5 <= ts <= t.end + 5]
    return " ".join(f"{t.speaker}: {t.text}" for t in near)[:300]


async def generate_debrief(session: SessionState, metrics: Metrics, timeline: list[TimelinePoint],
                           last: SessionSummary | None) -> Debrief:
    me_turns = [t for t in session.turns if t.speaker == "me"]
    best = min(me_turns, key=lambda t: len(t.fillers) / max(1, len(t.text.split())), default=None)
    vs_last = None
    if last is not None:
        vs_last = (f"Last time you talked {last.numbers.talk_ratio:.0%} of the time; "
                   f"this time {metrics.talk_ratio:.0%}.")
    return Debrief(
        headline_fact=(f"You talked {metrics.talk_ratio:.0%} of the time and asked "
                       f"{metrics.questions} question{'s' if metrics.questions != 1 else ''}."),
        strength="You stayed engaged and kept the conversation moving.",
        one_fix="Your turns ran long before you handed the conversation back.",
        if_then="When you hit 30 seconds, end with a question.",
        numbers=_numbers(metrics),
        best_moment_quote=best.text[:200] if best else "",
        vs_last_time=vs_last,
        notes=[f"{len(session.turns)} turns over {session.duration_s:.0f} s."],
        bookmarks=[BookmarkReview(ts=b.ts, source=b.source, snippet=_snippet(session, b.ts),
                                  what_happened=b.text or "Bookmarked moment",
                                  follow_up=b.text if b.source == "promise" else None)
                   for b in session.bookmarks],
        timeline=timeline,
        better_version=None,
    )


def spoken_text(debrief: Debrief) -> str:
    return " ".join([debrief.headline_fact, debrief.strength, debrief.one_fix, debrief.if_then])[:2000]


async def speak(text: str, session_id: str) -> str | None:
    """STUB: no audio. Worker: Deepgram Aura-2 REST call (plan.md 3.2)."""
    return None


@router.get("/sessions/{session_id}/debrief")
def get_debrief(session_id: str, st: AppState = Depends(get_app_state)) -> dict:
    found = st.db.load_debrief(session_id)
    if found is None:
        raise HTTPException(404, f"no debrief for {session_id}")
    debrief, audio_url = found
    return {"session_id": session_id, "data": debrief.model_dump(mode="json"), "audio_url": audio_url}
