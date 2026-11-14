"""Shared value types and tuning for voice memory. Pure data: no I/O, no model.

Times are seconds on the conversation's clock (a turn's `start`/`end`), unless a name says
otherwise. Embeddings are 1-D float32 numpy arrays, L2-normalised wherever they are stored or
compared (`prints.normalize`).
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

SAMPLE_RATE = 16_000

Role = str  # "me" | "other"


@dataclass(frozen=True)
class TimedWord:
    """One final Deepgram word on the conversation clock, with Deepgram's speaker label."""

    text: str
    start: float
    end: float
    label: int


@dataclass(frozen=True)
class TurnSpan:
    """A stored turn reduced to what segmentation needs (used when no word timings exist)."""

    turn_id: str
    start: float
    end: float
    speaker: Role  # the stored (live) label: "me" | "other"


@dataclass(frozen=True)
class Span:
    """A stretch of speech to embed.

    words: indices into the conversation's word list (empty when cut from turns).
    turn_id: the turn it was cut from (turn-window spans only, else None).
    label: Deepgram label (word spans) or None (turn windows).
    """

    start: float
    end: float
    label: int | None = None
    words: tuple[int, ...] = ()
    turn_id: str | None = None

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


@dataclass(frozen=True)
class Exemplar:
    session_id: str
    embedding: np.ndarray
    seconds: float


@dataclass(frozen=True)
class Voiceprint:
    """A remembered voice: up to `cap` exemplars; the centroid is their robust mean."""

    voice_id: str
    centroid: np.ndarray
    exemplars: tuple[Exemplar, ...] = ()
    samples: int = 0  # every accepted sighting, never capped


@dataclass(frozen=True)
class Match:
    voice_id: str | None  # None: no voice cleared threshold + margin
    similarity: float  # best similarity (or -1.0 with no voices)
    margin: float  # best minus second best (1.0 when there is only one voice)
    best_id: str | None = None  # best candidate even when it did not clear


@dataclass(frozen=True)
class VoiceConfig:
    """Tuning. Similarity thresholds are cosine on L2-normalised embeddings, calibrated with
    scripts/eval_voices.py for NeMo TitaNet-small (the default model; backend/README.md).
    On the synthetic set, conversation-cluster centroids of one speaker scored 0.79-0.96 and of
    different speakers 0.01-0.35: the match and wearer thresholds sit in that gap, well above
    the different-speaker ceiling, leaving room for real voices that sound more alike."""

    min_embed_s: float = 1.0  # shorter spans are not embedded on their own
    max_span_s: float = 6.0  # a word span is cut at this length
    word_gap_s: float = 0.6  # a pause longer than this ends a word span
    pool_gap_s: float = 1.0  # short neighbours of one label closer than this are pooled
    window_s: float = 3.0  # turn windows (no word timings)
    pad_s: float = 0.05  # audio padding around a span when slicing
    cluster_sim: float = 0.3  # agglomerative clustering stops below this average span similarity
    label_bonus: float = 0.05  # same Deepgram label: a small tie-break in clustering
    min_cluster_s: float = 2.0  # smaller clusters are absorbed into the nearest larger one
    match_sim: float = 0.55  # a cluster matches a stored voice at or above this ...
    match_margin: float = 0.1  # ... and this far above the second-best voice
    wearer_sim: float = 0.5  # a cluster is the wearer at or above this
    exemplar_cap: int = 20
    outlier_sim: float = 0.25  # an exemplar below this similarity to the centroid is not used
    min_print_s: float = 3.0  # a cluster needs this much speech to create or update a voiceprint
    bootstrap_confirmations: int = 3  # conversations before a bootstrapped wearer print is trusted


@dataclass(frozen=True)
class SpeakerCluster:
    """One voice heard in a conversation."""

    index: int
    members: tuple[int, ...]  # indices into the embedded spans
    centroid: np.ndarray
    seconds: float
    level_db: float | None = None  # median loudness of its spans (dBFS)
    labels: dict[int, float] = field(default_factory=dict)  # Deepgram label -> seconds
