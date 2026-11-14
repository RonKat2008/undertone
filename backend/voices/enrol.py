"""Wearer enrolment: a voiceprint from N seconds of the wearer speaking alone. Blocking.

Sources: the band's live audio (POST /voices/wearer/enrol: the last N seconds the recorder's
rolling pre-buffer holds, after a spoken prompt window) or an uploaded 16 kHz mono WAV
(POST /voices/wearer/enrol/wav). Re-enrolling replaces the print; DELETE clears it.
"""

from __future__ import annotations

import io
import logging
import wave

import numpy as np

from backend.db import DB
from backend.voices import store
from backend.voices.audio import pcm16_to_float, voiced
from backend.voices.embedder import Embedder
from backend.voices.memory import ENROL_SESSION
from backend.voices.prints import normalize, robust_centroid
from backend.voices.store import WEARER_ID, VoiceRow
from backend.voices.types import SAMPLE_RATE, Exemplar, VoiceConfig, Voiceprint

log = logging.getLogger("undertone.voices")

MIN_ENROL_S = 6.0  # voiced speech needed
WINDOW_S = 3.0
HOP_S = 1.5


class EnrolError(ValueError):
    """Not enough speech, or unreadable audio."""


def wav_bytes_to_samples(data: bytes) -> np.ndarray:
    try:
        with wave.open(io.BytesIO(data), "rb") as w:
            if w.getframerate() != SAMPLE_RATE or w.getnchannels() != 1 or w.getsampwidth() != 2:
                raise EnrolError("audio must be 16 kHz mono 16-bit WAV")
            return pcm16_to_float(w.readframes(w.getnframes()))
    except (wave.Error, EOFError) as exc:
        raise EnrolError("not a readable WAV file") from exc


def windows(x: np.ndarray, window_s: float = WINDOW_S, hop_s: float = HOP_S) -> list[np.ndarray]:
    """Pure: overlapping windows over voiced audio (the tail joins the last window)."""
    n, hop = int(window_s * SAMPLE_RATE), int(hop_s * SAMPLE_RATE)
    if len(x) <= n:
        return [x] if len(x) else []
    starts = list(range(0, len(x) - n + 1, hop))
    out = [x[s:s + n] for s in starts]
    if len(x) - (starts[-1] + n) > hop // 2:
        out.append(x[-n:])
    return out


def enrol_wearer(db: DB, samples: np.ndarray, embedder: Embedder, cfg: VoiceConfig) -> VoiceRow:
    speech = voiced(samples)
    secs = len(speech) / SAMPLE_RATE
    if secs < MIN_ENROL_S:
        raise EnrolError(f"only {secs:.1f} s of speech heard; need {MIN_ENROL_S:.0f} s")
    exemplars = tuple(Exemplar(ENROL_SESSION, normalize(embedder.embed(w)), len(w) / SAMPLE_RATE)
                      for w in windows(speech))[: cfg.exemplar_cap]
    centroid = robust_centroid([e.embedding for e in exemplars], [e.seconds for e in exemplars], cfg.outlier_sim)
    now = store.now_iso()
    row = VoiceRow(WEARER_ID, None, None, None, True, "enrolled", embedder.name, 1, secs, now, now,
                   Voiceprint(WEARER_ID, centroid, exemplars, 1))
    store.save_voice(db, row)
    log.info("voice memory: wearer enrolled from %.1f s of speech (%d windows)", secs, len(exemplars))
    return row
