"""Decide who each speaker cluster is, and remember it.

Pure decisions (decide_wearer, match_others) are separate from the writes (remember, undo).

Wearer rule, in order:
  1. An enrolled (or confirmed) wearer print: every cluster at or above cfg.wearer_sim is the
     wearer. Labels are corrected only when at least one cluster matched.
  2. No trusted print (bootstrap): the band is on the wearer's wrist, so the loudest cluster
     (>= 3 dB above the next) is the wearer *provisionally*. Its print is kept as 'provisional';
     labels are corrected only when the provisional print and the loudness pick agree. After
     cfg.bootstrap_confirmations conversations where they agree, the print is 'confirmed'.
     Risk: if someone else is consistently louder than the wearer (they lean in, the wearer
     whispers) the provisional print can be theirs; enrolment removes the risk.
"""

from __future__ import annotations

import logging
from collections.abc import Sequence
from dataclasses import dataclass, replace

import numpy as np

from backend.db import DB
from backend.voices import people, store
from backend.voices.cluster import bootstrap_wearer
from backend.voices.prints import add_exemplar, cosine, match_voice, new_voiceprint, remove_session, robust_centroid
from backend.voices.store import WEARER_ID, VoiceRow
from backend.voices.types import Exemplar, Role, SpeakerCluster, VoiceConfig, Voiceprint

log = logging.getLogger("undertone.voices")

TRUSTED_STATES = frozenset({"enrolled", "confirmed"})
ENROL_SESSION = "enrol"


@dataclass(frozen=True)
class WearerDecision:
    clusters: frozenset[int]
    similarity: float | None
    source: str  # enrolled | confirmed | provisional | bootstrap | none
    trusted: bool  # stored labels may be corrected
    matched: bool = False  # a stored wearer print matched (not a loudness-only guess)


@dataclass(frozen=True)
class ClusterDecision:
    cluster: int
    role: Role
    voice_id: str | None
    decision: str  # wearer | matched | new | weak
    similarity: float | None
    margin: float | None
    seconds: float


def _sims(clusters: Sequence[SpeakerCluster], centroid: np.ndarray) -> dict[int, float]:
    return {c.index: cosine(c.centroid, centroid) for c in clusters}


def decide_wearer(clusters: Sequence[SpeakerCluster], wearer: VoiceRow | None, cfg: VoiceConfig) -> WearerDecision:
    if not clusters:
        return WearerDecision(frozenset(), None, "none", False)
    loud = bootstrap_wearer(clusters)
    if wearer is None:
        picked = frozenset({loud}) if loud is not None else frozenset()
        return WearerDecision(picked, None, "bootstrap" if picked else "none", False)
    sims = _sims(clusters, wearer.voiceprint.centroid)
    hits = frozenset(i for i, s in sims.items() if s >= cfg.wearer_sim)
    best = max(sims.values())
    if wearer.wearer_state in TRUSTED_STATES:
        return WearerDecision(hits, round(best, 3), wearer.wearer_state or "enrolled", bool(hits), bool(hits))
    if hits:
        agree = loud is not None and loud in hits
        return WearerDecision(hits, round(best, 3), "provisional", agree, True)
    picked = frozenset({loud}) if loud is not None else frozenset()
    return WearerDecision(picked, round(best, 3), "provisional" if picked else "none", False)


def match_others(clusters: Sequence[SpeakerCluster], wearer: WearerDecision, voices: Sequence[Voiceprint],
                 cfg: VoiceConfig) -> list[ClusterDecision]:
    """Largest first; one stored voice per cluster at most."""
    out: list[ClusterDecision] = []
    used: set[str] = set()
    for c in sorted(clusters, key=lambda c: -c.seconds):
        if c.index in wearer.clusters:
            out.append(ClusterDecision(c.index, "me", WEARER_ID, "wearer", wearer.similarity, None, c.seconds))
            continue
        m = match_voice(c.centroid, voices, cfg.match_sim, cfg.match_margin, exclude=frozenset(used))
        sim, margin = round(m.similarity, 3), round(m.margin, 3)
        if m.voice_id is not None:
            used.add(m.voice_id)
            out.append(ClusterDecision(c.index, "other", m.voice_id, "matched", sim, margin, c.seconds))
        elif c.seconds >= cfg.min_print_s:
            out.append(ClusterDecision(c.index, "other", None, "new", sim if voices else None, None, c.seconds))
        else:
            out.append(ClusterDecision(c.index, "other", None, "weak", sim if voices else None, None, c.seconds))
    return out


# ---------- writes ----------
def _wearer_with(row: VoiceRow, ex: Exemplar, cfg: VoiceConfig) -> VoiceRow:
    """Add a conversation exemplar to the wearer; enrolment exemplars are never evicted."""
    pinned = tuple(e for e in row.voiceprint.exemplars if e.session_id == ENROL_SESSION)
    rest = tuple(e for e in row.voiceprint.exemplars if e.session_id != ENROL_SESSION)
    probe = replace(row.voiceprint, exemplars=rest)
    room = max(1, cfg.exemplar_cap - len(pinned))
    updated, ok = add_exemplar(probe, ex, replace(cfg, exemplar_cap=room))
    if not ok:
        return row
    exemplars = pinned + updated.exemplars
    centroid = robust_centroid([e.embedding for e in exemplars], [e.seconds for e in exemplars], cfg.outlier_sim)
    vp = Voiceprint(WEARER_ID, centroid, exemplars, row.voiceprint.samples + 1)
    return replace(row, voiceprint=vp, samples=vp.samples)


def remember_wearer(db: DB, session_id: str, clusters: Sequence[SpeakerCluster], decision: WearerDecision,
                    model: str, cfg: VoiceConfig, heard_at: str) -> bool:
    """Store the wearer's sample. Returns True when a provisional print just became confirmed.

    A provisional print is fed only by clusters that matched it (never by a loudness-only guess),
    so one wrong guess cannot drift it toward somebody else."""
    picked = [c for c in clusters if c.index in decision.clusters and c.seconds >= cfg.min_print_s]
    row = store.wearer(db)
    if not picked or (row is not None and not decision.matched):
        return False
    biggest = max(picked, key=lambda c: c.seconds)
    ex = Exemplar(session_id, biggest.centroid, biggest.seconds)
    if row is None:
        vp = new_voiceprint(WEARER_ID, ex)
        store.save_voice(db, VoiceRow(WEARER_ID, None, None, None, True, "provisional", model, vp.samples,
                                      ex.seconds, heard_at, heard_at, vp))
        return False
    updated = replace(_wearer_with(row, ex, cfg), last_heard_at=heard_at)
    confirmed = (row.wearer_state == "provisional" and decision.trusted
                 and updated.samples >= cfg.bootstrap_confirmations)
    store.save_voice(db, replace(updated, wearer_state="confirmed") if confirmed else updated)
    return confirmed


def remember_others(db: DB, session_id: str, clusters: Sequence[SpeakerCluster],
                    decisions: Sequence[ClusterDecision], model: str, cfg: VoiceConfig,
                    heard_at: str) -> list[ClusterDecision]:
    """Update matched voices, create new ones. Returns decisions with voice ids filled in."""
    by_index = {c.index: c for c in clusters}
    out: list[ClusterDecision] = []
    for d in decisions:
        c = by_index[d.cluster]
        if d.decision == "matched" and d.voice_id is not None:
            row = store.get_voice(db, d.voice_id)
            if row is not None and c.seconds >= cfg.min_print_s:
                vp, _ = add_exemplar(row.voiceprint, Exemplar(session_id, c.centroid, c.seconds), cfg)
                store.save_voice(db, replace(row, voiceprint=vp, samples=vp.samples, last_heard_at=heard_at))
            elif row is not None:
                store.save_voice(db, replace(row, last_heard_at=heard_at))
            out.append(d)
        elif d.decision == "new":
            out.append(replace(d, voice_id=_create_voice(db, session_id, c, model, heard_at)))
        else:
            out.append(d)
    return out


def _create_voice(db: DB, session_id: str, c: SpeakerCluster, model: str, heard_at: str) -> str:
    number = store.next_number(db)
    voice_id = f"v{number}"
    person_id = people.ensure_unknown_person(db, number)
    vp = new_voiceprint(voice_id, Exemplar(session_id, c.centroid, c.seconds))
    store.save_voice(db, VoiceRow(voice_id, number, None, person_id, False, None, model, vp.samples, c.seconds,
                                  heard_at, heard_at, vp))
    log.info("voice memory: new voice %s (%.1f s) in %s", voice_id, c.seconds, session_id)
    return voice_id


def undo_session(db: DB, session_id: str, cfg: VoiceConfig) -> None:
    """Take one conversation's samples back out of every voiceprint (before a rerun)."""
    for row in store.list_voices(db, include_wearer=True):
        if not any(e.session_id == session_id for e in row.voiceprint.exemplars):
            continue
        vp = remove_session(row.voiceprint, session_id, cfg)
        if vp is not None:
            store.save_voice(db, replace(row, voiceprint=vp, samples=vp.samples))
            continue
        others = [s for s in store.sightings_for_voice(db, row.voice_id) if s.session_id != session_id]
        if row.is_wearer or others or row.name:  # keep the row (old centroid), drop this sample
            empty = replace(row.voiceprint, exemplars=(), samples=max(0, row.samples - 1))
            store.save_voice(db, replace(row, voiceprint=empty, samples=empty.samples))
            continue
        store.delete_voice(db, row.voice_id)
        people.drop_unknown_person(db, row.person_id)
    store.clear_session_results(db, session_id)
