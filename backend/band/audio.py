"""PCM helpers: 20 ms packets -> 80 ms chunks, and loudness per chunk.

Audio clock: every chunk is exactly 80 ms of 16 kHz mono s16le, so session time for audio
is simply chunks_emitted * 0.08. Deepgram's word times use the same clock because the
Pipecat worker is built fresh at session start.
"""
from __future__ import annotations

import math
from bisect import bisect_left, bisect_right
from typing import List, Optional, Tuple

import numpy as np

SAMPLE_RATE = 16000
BYTES_PER_SAMPLE = 2
CHUNK_S = 0.08
CHUNK_BYTES = int(SAMPLE_RATE * CHUNK_S) * BYTES_PER_SAMPLE  # 2560
SILENCE_DB = -96.0


class Chunker:
    """Collects PCM bytes of any size and returns whole 80 ms chunks."""

    def __init__(self, chunk_bytes: int = CHUNK_BYTES) -> None:
        self.chunk_bytes = chunk_bytes
        self._buf = bytearray()
        self.chunks_out = 0

    def feed(self, pcm: bytes) -> List[bytes]:
        self._buf.extend(pcm)
        out = []
        while len(self._buf) >= self.chunk_bytes:
            out.append(bytes(self._buf[: self.chunk_bytes]))
            del self._buf[: self.chunk_bytes]
        self.chunks_out += len(out)
        return out

    @property
    def seconds(self) -> float:
        """Session audio clock: seconds of audio emitted so far."""
        return self.chunks_out * self.chunk_bytes / (SAMPLE_RATE * BYTES_PER_SAMPLE)

    def reset(self) -> None:
        self._buf.clear()
        self.chunks_out = 0


def rms_db(pcm: bytes) -> float:
    """Loudness of s16le PCM in dBFS (0 = full scale, -96 = silence)."""
    if not pcm:
        return SILENCE_DB
    x = np.frombuffer(pcm, dtype="<i2").astype(np.float64) / 32768.0
    rms = math.sqrt(float(np.mean(x * x))) if x.size else 0.0
    return max(SILENCE_DB, 20 * math.log10(rms)) if rms > 0 else SILENCE_DB


class LoudnessTimeline:
    """dB of every 80 ms chunk, by session time. Lets anyone ask how loud a turn or word was.

    B's metrics engine can call `mean_db(turn.start, turn.end)` for the wearer's volume.
    """

    def __init__(self, max_seconds: float = 3 * 3600) -> None:
        self._t: List[float] = []
        self._db: List[float] = []
        self._max = int(max_seconds / CHUNK_S)

    def add(self, t_end: float, db: float) -> None:
        self._t.append(t_end - CHUNK_S / 2)  # centre of the chunk
        self._db.append(db)
        if len(self._t) > self._max:
            del self._t[: len(self._t) - self._max]
            del self._db[: len(self._db) - self._max]

    def mean_db(self, start: float, end: float) -> Optional[float]:
        """Mean loudness between two session times, averaged in the power domain."""
        i, j = bisect_left(self._t, start), bisect_right(self._t, end)
        if j <= i:
            return None
        p = [10 ** (d / 10) for d in self._db[i:j]]
        return 10 * math.log10(sum(p) / len(p))

    def last(self, seconds: float) -> Optional[float]:
        if not self._t:
            return None
        return self.mean_db(self._t[-1] - seconds, self._t[-1] + 1)

    def reset(self) -> None:
        self._t.clear()
        self._db.clear()


def mean_db_of_spans(timeline: LoudnessTimeline, spans: List[Tuple[float, float]]) -> Optional[float]:
    vals = [timeline.mean_db(s, e) for s, e in spans]
    vals = [v for v in vals if v is not None]
    if not vals:
        return None
    return 10 * math.log10(sum(10 ** (v / 10) for v in vals) / len(vals))
