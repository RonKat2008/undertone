"""Cluster one conversation's span embeddings into speakers, and pick the wearer. Pure."""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from backend.voices.prints import cosine, normalize
from backend.voices.types import SpeakerCluster, VoiceConfig

_BOOTSTRAP_MIN_S = 2.0


def _dominant(members: list[int], seconds: Sequence[float],
              labels: Sequence[int | None]) -> int | None:
    totals: dict[int, float] = {}
    for m in members:
        if labels[m] is not None:
            totals[labels[m]] = totals.get(labels[m], 0.0) + float(seconds[m])
    if not totals:
        return None
    return max(totals.items(), key=lambda kv: (kv[1], -kv[0]))[0]


def _best_pair(groups: list[list[int]], sums: np.ndarray, dom: list[int | None],
               bonus: float) -> tuple[float, int, int]:
    best = (-np.inf, -1, -1)
    for a in range(len(groups)):
        for b in range(a + 1, len(groups)):
            score = sums[a, b] / (len(groups[a]) * len(groups[b]))
            if dom[a] is not None and dom[a] == dom[b]:
                score += bonus
            if score > best[0]:
                best = (float(score), a, b)
    return best


def _agglomerate(sim: np.ndarray, seconds: Sequence[float], labels: Sequence[int | None],
                 threshold: float, bonus: float) -> list[list[int]]:
    groups = [[i] for i in range(len(sim))]
    sums = sim.astype(np.float64).copy()
    dom = [_dominant(g, seconds, labels) for g in groups]
    while len(groups) > 1:
        score, a, b = _best_pair(groups, sums, dom, bonus)
        if score < threshold:
            break
        merged_row = sums[a] + sums[b]
        sums = sums.copy()
        sums[a, :] = merged_row
        sums[:, a] = merged_row
        sums = np.delete(np.delete(sums, b, axis=0), b, axis=1)
        groups = [g + groups[b] if i == a else g for i, g in enumerate(groups) if i != b]
        dom = [_dominant(g, seconds, labels) for g in groups]
    return groups


def _absorb_small(groups: list[list[int]], sim: np.ndarray, seconds: Sequence[float],
                  min_s: float) -> list[list[int]]:
    totals = [sum(float(seconds[m]) for m in g) for g in groups]
    big = [i for i, t in enumerate(totals) if t >= min_s]
    if not big:
        return groups
    out = {i: list(groups[i]) for i in big}
    for i, t in enumerate(totals):
        if t >= min_s:
            continue
        sims = [float(sim[np.ix_(groups[i], groups[j])].mean()) for j in big]
        out[big[int(np.argmax(sims))]].extend(groups[i])
    return list(out.values())


REFINE_ITERS = 3


def _refine(groups: list[list[int]], vecs: np.ndarray, seconds: Sequence[float]) -> list[list[int]]:
    """A few k-means passes: each span moves to the nearest seconds-weighted centroid, which
    cleans up spans that average linkage attached to the wrong speaker early on."""
    w = np.asarray([float(s) for s in seconds], dtype=np.float64)
    for _ in range(REFINE_ITERS):
        if len(groups) < 2:
            return groups
        cents = np.stack([normalize((vecs[g] * w[g, None]).sum(axis=0)) for g in groups])
        nearest = np.argmax(vecs @ cents.T, axis=1)
        moved = [[i for i in range(len(vecs)) if nearest[i] == k] for k in range(len(groups))]
        moved = [g for g in moved if g]
        if sorted(map(sorted, moved)) == sorted(map(sorted, groups)):
            return groups
        groups = moved
    return groups


def cluster_spans(embeddings: np.ndarray, seconds: Sequence[float],
                  labels: Sequence[int | None], cfg: VoiceConfig) -> list[int]:
    """Average-linkage clustering on cosine similarity; cluster index per span, 0 = most speech."""
    n = len(seconds)
    if n == 0:
        return []
    if n == 1:
        return [0]
    vecs = np.stack([normalize(e) for e in np.asarray(embeddings)])
    sim = vecs @ vecs.T
    groups = _agglomerate(sim, seconds, labels, cfg.cluster_sim, cfg.label_bonus)
    groups = _absorb_small(groups, sim, seconds, cfg.min_cluster_s)
    groups = _refine(groups, vecs, seconds)
    order = sorted(groups, key=lambda g: (-sum(float(seconds[m]) for m in g), min(g)))
    assign = [0] * n
    for k, g in enumerate(order):
        for m in g:
            assign[m] = k
    return assign


def _one_cluster(k: int, members: list[int], embeddings: np.ndarray, seconds: Sequence[float],
                 labels: Sequence[int | None], levels: Sequence[float | None]) -> SpeakerCluster:
    w = np.asarray([float(seconds[m]) for m in members], dtype=np.float64)
    vecs = np.stack([normalize(embeddings[m]) for m in members]).astype(np.float64)
    mean = (vecs * w[:, None]).sum(axis=0) / w.sum() if w.sum() > 0 else vecs.mean(axis=0)
    lv = [levels[m] for m in members if levels[m] is not None]
    by_label: dict[int, float] = {}
    for m in members:
        if labels[m] is not None:
            by_label[labels[m]] = by_label.get(labels[m], 0.0) + float(seconds[m])
    return SpeakerCluster(
        index=k, members=tuple(members), centroid=normalize(mean), seconds=float(w.sum()),
        level_db=float(np.median(lv)) if lv else None, labels=by_label,
    )


def build_clusters(assign: Sequence[int], embeddings: np.ndarray, seconds: Sequence[float],
                   labels: Sequence[int | None],
                   levels: Sequence[float | None]) -> list[SpeakerCluster]:
    """One SpeakerCluster per cluster index in `assign`."""
    if len(assign) == 0:
        return []
    embs = np.asarray(embeddings)
    return [
        _one_cluster(k, [i for i, a in enumerate(assign) if a == k], embs, seconds, labels,
                     levels)
        for k in range(max(assign) + 1)
        if any(a == k for a in assign)
    ]


def pick_wearer(clusters: Sequence[SpeakerCluster], wearer: np.ndarray | None,
                threshold: float) -> tuple[int | None, float]:
    """The cluster closest to the wearer's print when it clears threshold, with its similarity."""
    if wearer is None or not clusters:
        return None, -1.0
    sims = [cosine(c.centroid, wearer) for c in clusters]
    best = int(np.argmax(sims))
    if sims[best] >= threshold:
        return clusters[best].index, sims[best]
    return None, sims[best]


def bootstrap_wearer(clusters: Sequence[SpeakerCluster], min_gap_db: float = 3.0) -> int | None:
    """No enrolled print: the loudest cluster (the band is on the wearer's wrist), if clearly so."""
    leveled = sorted((c for c in clusters if c.level_db is not None),
                     key=lambda c: c.level_db, reverse=True)
    if not leveled or leveled[0].seconds < _BOOTSTRAP_MIN_S:
        return None
    if len(leveled) == 1 or leveled[0].level_db - leveled[1].level_db >= min_gap_db:
        return leveled[0].index
    return None
