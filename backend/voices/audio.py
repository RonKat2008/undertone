"""Pure audio helpers for voice memory (numpy only): decode, slice, measure, trim silence."""

from __future__ import annotations

import numpy as np

from backend.voices.types import SAMPLE_RATE

_INT16_SCALE = 32768.0
_SILENT_RMS = 1e-10


def pcm16_to_float(data: bytes) -> np.ndarray:
    """Little-endian int16 PCM -> float32 samples in [-1, 1]."""
    usable = len(data) - (len(data) % 2)
    ints = np.frombuffer(data[:usable], dtype="<i2")
    return (ints.astype(np.float32) / _INT16_SCALE).astype(np.float32)


def slice_seconds(
    samples: np.ndarray, start_s: float, end_s: float, sample_rate: int = SAMPLE_RATE
) -> np.ndarray:
    """Samples between start_s and end_s, clamped to the buffer (may be empty)."""
    n = len(samples)
    lo = min(max(round(start_s * sample_rate), 0), n)
    hi = min(max(round(end_s * sample_rate), lo), n)
    return samples[lo:hi].copy()


def level_db(x: np.ndarray) -> float | None:
    """RMS level in dBFS; None for empty or silent input."""
    if x.size == 0:
        return None
    rms = float(np.sqrt(np.mean(np.square(x.astype(np.float64)))))
    if rms <= _SILENT_RMS:
        return None
    return 20.0 * float(np.log10(rms))


def _frame_db(frames: np.ndarray) -> np.ndarray:
    rms = np.sqrt(np.mean(np.square(frames.astype(np.float64)), axis=1))
    return 20.0 * np.log10(np.maximum(rms, _SILENT_RMS))


def voiced(
    x: np.ndarray,
    sample_rate: int = SAMPLE_RATE,
    frame_s: float = 0.03,
    floor_db: float = -50.0,
    rel_db: float = 25.0,
) -> np.ndarray:
    """Concatenate frames louder than max(floor_db, loudest frame - rel_db); empty if none.

    A trailing partial frame is kept as its own frame."""
    frame_len = max(1, round(frame_s * sample_rate))
    if x.size == 0:
        return np.zeros(0, dtype=np.float32)
    n_full = len(x) // frame_len
    pad = (-len(x)) % frame_len
    padded = np.concatenate([x, np.zeros(pad, dtype=x.dtype)]) if pad else x
    frames = padded.reshape(-1, frame_len)
    # Measure the partial frame on its real samples only.
    db = _frame_db(frames)
    if pad:
        tail = x[n_full * frame_len:]
        db[-1] = _frame_db(tail.reshape(1, -1))[0]
    cutoff = max(floor_db, float(db.max()) - rel_db)
    keep = db > cutoff
    pieces = [
        x[i * frame_len:min((i + 1) * frame_len, len(x))] for i in np.flatnonzero(keep)
    ]
    if not pieces:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(pieces).astype(np.float32)
