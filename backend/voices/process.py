"""One conversation's audio -> spans -> embeddings -> speaker clusters -> a role per word / turn.

Blocking (model inference): run it in a worker thread. No database access here.

    a = analyse(samples, offset_s, turns, words, embedder, cfg)
    roles = span_roles(a, {cluster_index: "me" | "other"})
    per_word = word_roles(a, roles)          # aligned with a.words
    per_turn = turn_roles(a, roles)          # turn_id -> role, for turns without words
"""

from __future__ import annotations

import logging
import wave
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from backend.contracts import TurnFinalEvent
from backend.voices.audio import level_db, pcm16_to_float, slice_seconds, voiced
from backend.voices.cluster import build_clusters, cluster_spans
from backend.voices.embedder import Embedder
from backend.voices.prints import cosine, normalize
from backend.voices.segments import pool_short, spans_from_turns, spans_from_words
from backend.voices.types import SAMPLE_RATE, Role, Span, SpeakerCluster, TimedWord, TurnSpan, VoiceConfig

log = logging.getLogger("undertone.voices")

MIN_VOICED_S = 0.8  # voiced audio a span needs to count as a full embedding
MIN_WEAK_S = 0.4  # short spans with this much voiced audio get a weak embedding (no clustering)
WEAK_MARGIN = 0.05  # a weak span joins a cluster only this clearly
NEAREST_S = 1.5  # an un-embedded span takes the role of a same-label neighbour this close


@dataclass(frozen=True)
class Analysis:
    spans: tuple[Span, ...]
    embedded: tuple[int, ...]  # span indices with a full embedding (clustered)
    embeddings: np.ndarray  # (len(embedded), dim), normalised
    seconds: tuple[float, ...]  # voiced seconds per embedded span
    clusters: tuple[SpeakerCluster, ...]
    assign: dict[int, int]  # span index -> cluster index (full and weak embeddings)
    words: tuple[TimedWord, ...]
    from_words: bool


def read_wav(path: Path) -> np.ndarray:
    """A 16 kHz mono 16-bit WAV as float32. Raises ValueError on another format."""
    with wave.open(str(path), "rb") as w:
        if w.getframerate() != SAMPLE_RATE or w.getnchannels() != 1 or w.getsampwidth() != 2:
            raise ValueError(f"{path.name}: not 16 kHz mono 16-bit")
        return pcm16_to_float(w.readframes(w.getnframes()))


def build_spans(turns: Sequence[TurnFinalEvent], words: Sequence[TimedWord], cfg: VoiceConfig) -> list[Span]:
    if words:
        return pool_short(spans_from_words(words, cfg), cfg)
    spans = [TurnSpan(t.turn_id, t.start, t.end, t.speaker) for t in turns if t.end > t.start]
    return pool_short(spans_from_turns(spans, cfg), cfg)


def _embed(samples: np.ndarray, offset_s: float, span: Span, embedder: Embedder,
           cfg: VoiceConfig, min_s: float) -> tuple[np.ndarray, float, float | None] | None:
    raw = slice_seconds(samples, span.start + offset_s - cfg.pad_s, span.end + offset_s + cfg.pad_s)
    x = voiced(raw)
    secs = len(x) / SAMPLE_RATE
    if secs < min_s:
        return None
    try:
        emb = normalize(embedder.embed(x))
    except Exception:  # noqa: BLE001 - one bad span must not sink the conversation
        log.warning("voice memory: embedding a %.1f s span failed", secs, exc_info=True)
        return None
    if not np.all(np.isfinite(emb)) or not np.any(emb):
        return None
    return emb, secs, level_db(raw)


def _nearest_cluster(emb: np.ndarray, clusters: Sequence[SpeakerCluster], floor: float) -> int | None:
    sims = sorted(((cosine(emb, c.centroid), c.index) for c in clusters), reverse=True)
    if not sims or sims[0][0] < floor:
        return None
    if len(sims) > 1 and sims[0][0] - sims[1][0] < WEAK_MARGIN:
        return None
    return sims[0][1]


def analyse(samples: np.ndarray, offset_s: float, turns: Sequence[TurnFinalEvent],
            words: Sequence[TimedWord], embedder: Embedder, cfg: VoiceConfig) -> Analysis:
    spans = build_spans(turns, words, cfg)
    full: list[tuple[int, np.ndarray, float, float | None]] = []
    weak: list[tuple[int, np.ndarray]] = []
    for i, span in enumerate(spans):
        long_enough = span.duration >= cfg.min_embed_s
        got = _embed(samples, offset_s, span, embedder, cfg, MIN_VOICED_S if long_enough else MIN_WEAK_S)
        if got is None:
            continue
        if long_enough:
            full.append((i, got[0], got[1], got[2]))
        else:
            weak.append((i, got[0]))
    embedded = tuple(f[0] for f in full)
    embs = np.stack([f[1] for f in full]) if full else np.zeros((0, 1), dtype=np.float32)
    seconds = tuple(f[2] for f in full)
    labels = [spans[i].label for i in embedded]
    assign_list = cluster_spans(embs, seconds, labels, cfg) if full else []
    clusters = build_clusters(assign_list, embs, seconds, labels, [f[3] for f in full]) if full else []
    assign = {span_i: c for span_i, c in zip(embedded, assign_list)}
    for span_i, emb in weak:
        c = _nearest_cluster(emb, clusters, cfg.cluster_sim * 0.6)
        if c is not None:
            assign[span_i] = c
    return Analysis(tuple(spans), embedded, embs, seconds, tuple(clusters), assign, tuple(words), bool(words))


def span_roles(a: Analysis, cluster_roles: Mapping[int, Role]) -> list[Role | None]:
    """A role per span: its cluster's, else a close same-label neighbour's, else None."""
    direct: list[Role | None] = [cluster_roles.get(a.assign[i]) if i in a.assign else None
                                 for i in range(len(a.spans))]
    out = list(direct)
    for i, span in enumerate(a.spans):
        if out[i] is not None:
            continue
        best: tuple[float, Role] | None = None
        for j, other in enumerate(a.spans):
            role = direct[j]
            if role is None or other.label != span.label or other.turn_id != span.turn_id:
                continue
            gap = max(other.start - span.end, span.start - other.end, 0.0)
            if gap <= NEAREST_S and (best is None or gap < best[0]):
                best = (gap, role)
        out[i] = best[1] if best else None
    return out


def word_roles(a: Analysis, roles: Sequence[Role | None]) -> list[Role | None]:
    out: list[Role | None] = [None] * len(a.words)
    for span, role in zip(a.spans, roles):
        for w in span.words:
            if 0 <= w < len(out):
                out[w] = role
    return out


def turn_roles(a: Analysis, roles: Sequence[Role | None]) -> dict[str, Role]:
    """Turn windows (no words): the role holding most of the turn's seconds."""
    tally: dict[str, dict[Role, float]] = {}
    for span, role in zip(a.spans, roles):
        if span.turn_id is None or role is None:
            continue
        per = tally.setdefault(span.turn_id, {})
        per[role] = per.get(role, 0.0) + span.duration
    return {tid: max(per.items(), key=lambda kv: kv[1])[0] for tid, per in tally.items() if per}
