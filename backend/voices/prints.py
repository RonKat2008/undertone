"""Voiceprints: normalised embeddings, robust centroids, matching and exemplar upkeep. Pure."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace

import numpy as np

from backend.voices.types import Exemplar, Match, VoiceConfig, Voiceprint

_EPS = 1e-12


def normalize(v: np.ndarray) -> np.ndarray:
    """float32 copy with unit L2 norm; a zero vector stays zero."""
    arr = np.asarray(v, dtype=np.float32).copy()
    n = float(np.linalg.norm(arr))
    return arr if n <= _EPS else (arr / n).astype(np.float32)


def cosine(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.dot(normalize(a), normalize(b)))


def _weighted_mean(vecs: np.ndarray, w: np.ndarray) -> np.ndarray:
    total = float(w.sum())
    if total <= _EPS:
        return vecs.mean(axis=0)
    return (vecs * w[:, None]).sum(axis=0) / total


def robust_centroid(
    embeddings: Sequence[np.ndarray], weights: Sequence[float] | None, outlier_sim: float
) -> np.ndarray:
    """Weighted mean of normalised embeddings, dropping leave-one-out outliers (>= 3 members)."""
    if len(embeddings) == 0:
        raise ValueError("robust_centroid needs at least one embedding")
    vecs = np.stack([normalize(e) for e in embeddings]).astype(np.float64)
    w = np.ones(len(vecs)) if weights is None else np.asarray(weights, dtype=np.float64)
    if len(vecs) >= 3:
        keep = np.ones(len(vecs), dtype=bool)
        for i in range(len(vecs)):
            others = np.arange(len(vecs)) != i
            loo = normalize(_weighted_mean(vecs[others], w[others]))
            keep[i] = float(np.dot(vecs[i], loo)) >= outlier_sim
        if keep.any():
            vecs, w = vecs[keep], w[keep]
    return normalize(_weighted_mean(vecs, w))


def match_voice(
    query: np.ndarray,
    prints: Sequence[Voiceprint],
    threshold: float,
    margin: float,
    exclude: frozenset[str] = frozenset(),
) -> Match:
    """Best voiceprint by cosine; voice_id set only when it clears threshold and margin."""
    cands = [p for p in prints if p.voice_id not in exclude]
    if not cands:
        return Match(None, -1.0, 1.0, None)
    sims = sorted(((cosine(query, p.centroid), p.voice_id) for p in cands), reverse=True)
    best, best_id = sims[0]
    gap = best - sims[1][0] if len(sims) > 1 else 1.0
    ok = best >= threshold and gap >= margin
    return Match(best_id if ok else None, best, gap, best_id)


def _with_exemplars(vp: Voiceprint, exemplars: tuple[Exemplar, ...], samples: int,
                    cfg: VoiceConfig) -> Voiceprint:
    centroid = robust_centroid(
        [e.embedding for e in exemplars], [e.seconds for e in exemplars], cfg.outlier_sim
    )
    return replace(vp, centroid=centroid, exemplars=exemplars, samples=samples)


def add_exemplar(vp: Voiceprint, ex: Exemplar, cfg: VoiceConfig) -> tuple[Voiceprint, bool]:
    """Append an exemplar (newest cfg.exemplar_cap kept); reject an outlier once established."""
    if len(vp.exemplars) >= 2 and cosine(ex.embedding, vp.centroid) < cfg.outlier_sim:
        return vp, False
    exemplars = (vp.exemplars + (ex,))[-cfg.exemplar_cap:]
    return _with_exemplars(vp, exemplars, vp.samples + 1, cfg), True


def new_voiceprint(voice_id: str, ex: Exemplar) -> Voiceprint:
    return Voiceprint(voice_id=voice_id, centroid=normalize(ex.embedding), exemplars=(ex,),
                      samples=1)


def remove_session(vp: Voiceprint, session_id: str, cfg: VoiceConfig) -> Voiceprint | None:
    """Drop one session's exemplars; None when nothing remains."""
    kept = tuple(e for e in vp.exemplars if e.session_id != session_id)
    if not kept:
        return None
    removed = len(vp.exemplars) - len(kept)
    if removed == 0:
        return vp
    return _with_exemplars(vp, kept, max(0, vp.samples - removed), cfg)


def merge_prints(into: Voiceprint, other: Voiceprint, cfg: VoiceConfig) -> Voiceprint:
    """Union of exemplars (newest cap kept), samples summed, centroid recomputed."""
    exemplars = (into.exemplars + other.exemplars)[-cfg.exemplar_cap:]
    if not exemplars:
        return replace(into, samples=into.samples + other.samples)
    return _with_exemplars(into, exemplars, into.samples + other.samples, cfg)
