"""Record each conversation's audio, tapped where BandSource already cuts 80 ms chunks.

    rec = Recorder(settings, on_finished=store)      # store(RecordingInfo) -> None
    band.chunk_tap = rec.feed                        # hot path: deque append + put_nowait
    rec.begin(session_id, start_s)                   # start_s: stream time of the session's t=0
    info = rec.end()                                 # blocking join: call via asyncio.to_thread

Always-on opens a conversation only after its first turn is final, so a rolling pre-buffer of
PREBUFFER_S keeps the last stretch of stream audio; the file starts PRE_ROLL_S before t=0.
`offset_s` is the seconds of audio in the file before the session's t=0: add it to a turn's
`start` to find that turn in the file.
"""

from __future__ import annotations

import logging
import threading
from collections import deque
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from backend.capture.media import CaptureSettings, prune, recording_path
from backend.capture.wav import BYTES_PER_SECOND, WavWriter

log = logging.getLogger("undertone.capture")

PREBUFFER_S = 90.0  # a first turn longer than this starts the file after t=0 (offset < 0)
PRE_ROLL_S = 0.5
CHUNK_S = 0.08


@dataclass(frozen=True)
class RecordingInfo:
    session_id: str
    path: Path
    duration_s: float
    offset_s: float


@dataclass(frozen=True)
class _Chunk:
    start: float  # stream seconds
    data: bytes


@dataclass
class _Active:
    session_id: str
    writer: WavWriter
    offset_s: float


def first_chunk_index(starts: list[float], file_start: float) -> int:
    """Pure: index of the first buffered chunk that ends after `file_start`."""
    for i, s in enumerate(starts):
        if s + CHUNK_S > file_start + 1e-6:
            return i
    return len(starts)


class Recorder:
    def __init__(self, settings: CaptureSettings,
                 on_finished: Callable[[RecordingInfo], None] | None = None) -> None:
        self.settings = settings
        self.on_finished = on_finished
        self._buf: deque[_Chunk] = deque(maxlen=max(1, int(PREBUFFER_S / CHUNK_S)))
        self._last_end = -1.0
        self._active: _Active | None = None
        self._lock = threading.Lock()

    @property
    def active_session(self) -> str | None:
        active = self._active
        return active.session_id if active else None

    # ---------- hot path ----------
    def feed(self, chunk: bytes, t_end: float) -> None:
        """One chunk of stream audio ending at stream time `t_end`. O(1), never blocks."""
        if t_end <= self._last_end:  # the band clock restarted: old audio no longer lines up
            self._buf.clear()
        self._last_end = t_end
        start = t_end - len(chunk) / BYTES_PER_SECOND
        self._buf.append(_Chunk(start, chunk))
        active = self._active
        if active is not None:
            active.writer.write(chunk)

    def recent_audio(self, seconds: float) -> bytes:
        """The last `seconds` (at most PREBUFFER_S) of stream audio, 16-bit PCM. For voice enrolment."""
        chunks = list(self._buf)
        n = max(0, min(len(chunks), int(round(seconds / CHUNK_S))))
        return b"".join(c.data for c in chunks[len(chunks) - n:])

    def clear(self) -> None:
        """The band clock was reset (a manual session starts): drop the pre-buffer."""
        self._buf.clear()
        self._last_end = -1.0

    # ---------- session edges ----------
    def begin(self, session_id: str, start_s: float) -> float | None:
        """Open the file for a session whose t=0 is stream time `start_s`. Returns offset_s."""
        if not self.settings.enabled:
            return None
        path = recording_path(self.settings.directory, session_id)
        if path is None:
            log.warning("not recording session %r: unsafe id", session_id)
            return None
        with self._lock:
            if self._active is not None:
                self._finish_locked()
            try:
                writer = WavWriter(path, int(self.settings.max_file_s * BYTES_PER_SECOND))
            except OSError as exc:
                log.warning("not recording %s: %s", session_id, type(exc).__name__)
                return None
            buffered = list(self._buf)
            idx = first_chunk_index([c.start for c in buffered], start_s - PRE_ROLL_S)
            kept = buffered[idx:]
            for c in kept:
                writer.write(c.data)
            # nothing buffered (manual session right after a clock reset): the file starts at t=0.
            # Negative when t=0 is older than the pre-buffer: the file starts that much after t=0
            # (a turn is at `start + offset_s` in the file either way).
            offset = round(start_s - kept[0].start, 3) if kept else 0.0
            self._active = _Active(session_id, writer, offset)
        log.info("recording %s (%.1f s of pre-buffer, offset %.2f s)", session_id,
                 len(kept) * CHUNK_S, offset)
        return offset

    def end(self, session_id: str | None = None) -> RecordingInfo | None:
        """Close the open file (only if it belongs to `session_id`, when given). Blocking."""
        with self._lock:
            active = self._active
            if active is None or (session_id is not None and active.session_id != session_id):
                return None
            return self._finish_locked()

    def _finish_locked(self) -> RecordingInfo | None:
        active, self._active = self._active, None
        if active is None:
            return None
        result = active.writer.close()
        info = None
        if result is not None:
            info = RecordingInfo(active.session_id, result.path, round(result.duration_s, 3), active.offset_s)
            log.info("recording %s saved: %.1f s", active.session_id, info.duration_s)
        prune(self.settings.directory, self.settings.max_total_bytes,
              keep=frozenset({result.path.name}) if result else frozenset())
        if info is not None and self.on_finished is not None:
            try:
                self.on_finished(info)
            except Exception:  # noqa: BLE001 - storing metadata must never break session end
                log.exception("storing recording info for %s failed", active.session_id)
        return info
