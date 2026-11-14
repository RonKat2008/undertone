"""Stored voice memory -> REST payloads (backend/contracts.py). Names are resolved at read time,
so a voice renamed later shows its new name in every older conversation."""

from __future__ import annotations

from typing import Any

from backend.contracts import (
    SessionNameGuess, SessionSpeaker, SessionVoices, VoiceConflict, VoiceList, VoiceSummary, WearerVoice,
)
from backend.db import DB
from backend.voices import people, store
from backend.voices.naming import display_name
from backend.voices.store import VoiceRow


def _conflicts(rows: list[dict[str, Any]]) -> list[VoiceConflict]:
    return [VoiceConflict(session_id=r["session_id"], voice_name=r["voice_name"], heard_name=r["heard_name"],
                          created_at=r["created_at"]) for r in rows]


def voice_summary(db: DB, row: VoiceRow) -> VoiceSummary:
    sessions = [s.session_id for s in store.sightings_for_voice(db, row.voice_id)]
    named = row.name is not None or (row.person_id is not None and not people.is_unknown(row.person_id))
    return VoiceSummary(
        voice_id=row.voice_id, person_id=row.person_id, name=display_name(db, row), named=named,
        has_voiceprint=bool(row.voiceprint.exemplars), samples=row.samples,
        seconds=round(sum(e.seconds for e in row.voiceprint.exemplars), 1), last_heard=row.last_heard_at,
        sessions=list(dict.fromkeys(sessions)), conflicts=_conflicts(store.conflicts(db, voice_id=row.voice_id)))


def wearer_view(db: DB) -> WearerVoice:
    row = store.wearer(db)
    if row is None:
        return WearerVoice(state="none", has_voiceprint=False)
    state = row.wearer_state if row.wearer_state in ("provisional", "confirmed", "enrolled") else "provisional"
    return WearerVoice(state=state, has_voiceprint=bool(row.voiceprint.exemplars), samples=row.samples,  # type: ignore[arg-type]
                       seconds=round(sum(e.seconds for e in row.voiceprint.exemplars), 1),
                       last_heard=row.last_heard_at)


def voice_list(db: DB, enabled: bool, model: str | None) -> VoiceList:
    return VoiceList(enabled=enabled, model=model, wearer=wearer_view(db),
                     voices=[voice_summary(db, r) for r in store.list_voices(db)])


def _speaker(db: DB, d: dict[str, Any]) -> SessionSpeaker:
    vid = d.get("voice_id")
    row = store.get_voice(db, vid) if vid and vid != store.WEARER_ID else None
    name = display_name(db, row) if row is not None else None
    return SessionSpeaker(voice_id=vid if (row is not None or vid == store.WEARER_ID) else None,
                          person_id=row.person_id if row else None, name=name, role=d["role"],
                          decision=d["decision"], similarity=d.get("similarity"), margin=d.get("margin"),
                          seconds=round(float(d.get("seconds") or 0.0), 1))


def session_view(db: DB, session_id: str, enabled: bool) -> SessionVoices:
    run = store.get_run(db, session_id)
    if run is None:
        return SessionVoices(session_id=session_id, status="pending" if enabled else "off")
    rep = run["report"]
    guess = rep.get("name_guess")
    return SessionVoices(
        session_id=session_id, status=run["status"], reason=rep.get("reason"), processed_at=run["processed_at"],
        model=run.get("model"), wearer_source=rep.get("wearer_source"), wearer_similarity=rep.get("wearer_similarity"),
        labels_corrected=bool(rep.get("labels_corrected")), turns_relabelled=int(rep.get("turns_relabelled", 0)),
        turns_split=int(rep.get("turns_split", 0)), words_used=bool(rep.get("words_used")),
        speakers=[_speaker(db, d) for d in _current_speakers(db, session_id, rep)],
        name_guess=SessionNameGuess(**guess) if guess else None,
        conflicts=_conflicts(store.conflicts(db, session_id=session_id)),
        recomputed=list(rep.get("recomputed", [])), not_recomputed=list(rep.get("not_recomputed", [])))


def _current_speakers(db: DB, session_id: str, rep: dict[str, Any]) -> list[dict[str, Any]]:
    """The run's speakers, with voice ids/decisions updated by later merges and manual tags."""
    sightings = store.sightings_for_session(db, session_id)
    if not sightings:
        return list(rep.get("speakers", []))
    out = [{"voice_id": s.voice_id, "role": s.role, "decision": s.decision, "similarity": s.similarity,
            "margin": s.margin, "seconds": s.seconds} for s in sightings]
    weak = [d for d in rep.get("speakers", []) if not d.get("voice_id")]
    return out + weak
