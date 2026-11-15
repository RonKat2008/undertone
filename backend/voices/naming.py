"""Names for voices: a heard name, a rename, a merge, a manual tag, forgetting. Blocking DB work.

    apply_heard_name(db, session_id, voice_id, guess)  -> 'named' | 'confirmed' | 'conflict' | 'ignored'
    name_voice(db, voice_id, name)                       the user's rename (always wins)
    merge_voices(db, keep_id, drop_id, cfg)              one person heard as two voices
    on_manual_tag(db, session_id, person_id, cfg)        POST /sessions/{id}/person also teaches the voice
    forget_voice(db, voice_id)                           voiceprint and exemplars deleted
"""

from __future__ import annotations

import logging
from dataclasses import replace

from backend.db import DB
from backend.voices import people, store
from backend.voices.names import NameGuess
from backend.voices.prints import add_exemplar, merge_prints, new_voiceprint, remove_session
from backend.voices.recompute import refresh_people
from backend.voices.store import VoiceRow
from backend.voices.types import Exemplar, VoiceConfig

log = logging.getLogger("undertone.voices")


def display_name(db: DB, row: VoiceRow) -> str:
    return row.name or people.person_name(db, row.person_id) or people.unknown_name(row.number or 0)


def _link(db: DB, row: VoiceRow, name: str, person_id: str | None = None) -> VoiceRow:
    """Name a voice and move it (and its auto-tagged conversations) to a person: person_id when
    given (a manual tag names the exact person), else slugify(name)."""
    pid = person_id or people.ensure_person(db, name)
    old = row.person_id
    linked = replace(row, name=name.strip(), person_id=pid)
    store.save_voice(db, linked)
    people.move_person(db, old, pid)
    still_used = any(v.person_id == old for v in store.list_voices(db))
    if not still_used:
        people.drop_unknown_person(db, old)
    store.resolve_conflicts(db, row.voice_id)
    return linked


def name_voice(db: DB, voice_id: str, name: str) -> VoiceRow:
    """The user names (or renames) a voice. Raises LookupError / ValueError."""
    row = store.get_voice(db, voice_id)
    if row is None or row.is_wearer:
        raise LookupError(voice_id)
    linked = _link(db, row, name)
    refresh_people(db)
    return linked


def apply_heard_name(db: DB, session_id: str, voice_id: str | None, guess: NameGuess | None) -> str:
    """A confident name from the transcript: names an unnamed voice, confirms a named one, or is
    recorded as a conflict (never silently overwrites). Manually tagged conversations are left alone."""
    row = store.get_voice(db, voice_id) if voice_id else None
    if guess is None or row is None or row.is_wearer or session_id in people.manual_sessions(db):
        return "ignored"
    current = row.name or (None if people.is_unknown(row.person_id) else people.person_name(db, row.person_id))
    if current is None:
        _link(db, row, guess.name)
        log.info("voice memory: %s named %s from the transcript", voice_id, guess.name)
        return "named"
    if current.split()[0].lower() == guess.name.lower():
        return "confirmed"
    store.add_conflict(db, session_id, row.voice_id, current, guess.name)
    log.info("voice memory: %s is %s but %s was heard", voice_id, current, guess.name)
    return "conflict"


def merge_voices(db: DB, keep_id: str, drop_id: str, cfg: VoiceConfig) -> VoiceRow:
    keep, drop = store.get_voice(db, keep_id), store.get_voice(db, drop_id)
    if keep is None or drop is None or keep_id == drop_id or keep.is_wearer or drop.is_wearer:
        raise LookupError(f"{keep_id} / {drop_id}")
    vp = merge_prints(keep.voiceprint, drop.voiceprint, cfg)
    last = max(filter(None, [keep.last_heard_at, drop.last_heard_at]), default=None)
    merged = replace(keep, voiceprint=replace(vp, voice_id=keep_id), samples=vp.samples, last_heard_at=last)
    if merged.name is None and drop.name is not None:
        merged = replace(merged, name=drop.name, person_id=drop.person_id)
    store.save_voice(db, merged)
    store.move_sightings(db, drop_id, keep_id)
    people.move_person(db, drop.person_id, merged.person_id or "")
    store.delete_voice(db, drop_id)
    if drop.person_id != merged.person_id:
        people.drop_unknown_person(db, drop.person_id)
    refresh_people(db)
    return merged


def forget_voice(db: DB, voice_id: str) -> None:
    """Delete the voiceprint, exemplars and per-conversation embeddings. A named person stays in
    the people store (the user may have tagged them by hand); an 'Unknown voice' person goes."""
    row = store.get_voice(db, voice_id)
    if row is None or row.is_wearer:
        raise LookupError(voice_id)
    store.delete_voice(db, voice_id)
    people.drop_unknown_person(db, row.person_id)
    refresh_people(db)


def _detach(db: DB, row: VoiceRow, session_id: str, cfg: VoiceConfig) -> None:
    """Take one conversation's sample out of a voice that turned out to be someone else."""
    vp = remove_session(row.voiceprint, session_id, cfg)
    if vp is None:
        vp = replace(row.voiceprint, exemplars=(), samples=max(0, row.samples - 1))
    store.save_voice(db, replace(row, voiceprint=vp, samples=vp.samples))


def on_manual_tag(db: DB, session_id: str, person_id: str, cfg: VoiceConfig) -> str | None:
    """The user tagged a conversation: remember that, and attach the conversation's main other
    voice to that person. Returns the voice id now linked (None when nothing was heard yet)."""
    people.record_manual(db, session_id, person_id)
    others = [s for s in store.sightings_for_session(db, session_id) if s.role == "other" and s.voice_id]
    if not others:
        return None
    s = max(others, key=lambda s: s.seconds)
    row = store.get_voice(db, s.voice_id)
    name = people.person_name(db, person_id) or person_id
    target = next((v for v in store.list_voices(db) if v.person_id == person_id and v.voice_id != s.voice_id), None)
    if row is not None and row.person_id == person_id:
        store.update_sighting(db, session_id, s.voice_id, s.voice_id, "manual")
        return s.voice_id
    if row is not None and people.is_unknown(row.person_id):
        if target is not None and target.model == row.model:  # the person already has a voice: one voice
            merged = merge_voices(db, target.voice_id, row.voice_id, cfg)
            store.update_sighting(db, session_id, merged.voice_id, merged.voice_id, "manual")
            store.resolve_conflicts(db, merged.voice_id)
            return merged.voice_id
        _link(db, row, name, person_id)
        store.update_sighting(db, session_id, s.voice_id, s.voice_id, "manual")
        return s.voice_id
    if row is not None:
        _detach(db, row, session_id, cfg)
    model = row.model if row is not None else (target.model if target is not None else "unknown")
    voice_id = _attach_sample(db, target, s, person_id, name, model, cfg)
    store.update_sighting(db, session_id, s.voice_id, voice_id, "manual")
    store.resolve_conflicts(db, voice_id)
    return voice_id


def _attach_sample(db: DB, target: VoiceRow | None, s: store.Sighting, person_id: str, name: str,
                   model: str, cfg: VoiceConfig) -> str:
    if s.embedding is None:
        raise ValueError("sighting has no embedding")
    ex = Exemplar(s.session_id, s.embedding, s.seconds)
    if target is not None:
        vp, _ = add_exemplar(target.voiceprint, ex, cfg)
        store.save_voice(db, replace(target, voiceprint=vp, samples=vp.samples, last_heard_at=s.heard_at))
        return target.voice_id
    number = store.next_number(db)
    voice_id = f"v{number}"
    vp = new_voiceprint(voice_id, ex)
    store.save_voice(db, VoiceRow(voice_id, number, name, person_id, False, None, model, vp.samples, s.seconds,
                                  s.heard_at, s.heard_at, vp))
    return voice_id


def clear_wearer(db: DB) -> None:
    store.delete_voice(db, store.WEARER_ID)
