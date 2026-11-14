"""A WAV file written off the audio path: the caller only enqueues, a thread does the disk work.

    w = WavWriter(path, max_bytes=30 * 60 * 32000)
    w.write(chunk)        # never blocks; False when the chunk was not taken
    info = w.close()      # joins the thread, patches the header; None if the recording failed

A full queue (the disk fell behind) marks the recording failed: it is deleted on close rather
than kept with a hole in it, so turn times always line up with the file.
"""

from __future__ import annotations

import logging
import queue
import struct
import threading
from dataclasses import dataclass
from pathlib import Path

log = logging.getLogger("undertone.capture")

SAMPLE_RATE = 16000
CHANNELS = 1
SAMPLE_WIDTH = 2
BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * SAMPLE_WIDTH  # 32000: ~1.9 MB per minute
HEADER_BYTES = 44
DEFAULT_QUEUE_CHUNKS = 1000  # ~80 s of 80 ms chunks: room for the pre-buffer plus disk stalls
JOIN_TIMEOUT_S = 5.0


def wav_header(data_bytes: int, rate: int = SAMPLE_RATE, channels: int = CHANNELS,
               width: int = SAMPLE_WIDTH) -> bytes:
    """The 44-byte PCM WAV header for `data_bytes` of sample data."""
    block = channels * width
    return b"".join((
        b"RIFF", struct.pack("<I", 36 + data_bytes), b"WAVE",
        b"fmt ", struct.pack("<IHHIIHH", 16, 1, channels, rate, rate * block, block, width * 8),
        b"data", struct.pack("<I", data_bytes),
    ))


@dataclass(frozen=True)
class WavResult:
    path: Path
    data_bytes: int

    @property
    def duration_s(self) -> float:
        return self.data_bytes / BYTES_PER_SECOND


class WavWriter:
    def __init__(self, path: Path, max_bytes: int, queue_chunks: int = DEFAULT_QUEUE_CHUNKS) -> None:
        self.path = path
        self.max_bytes = max_bytes
        self.failed = False
        self.capped = False
        self._queued = 0
        self._written = 0
        self._q: queue.Queue[bytes | None] = queue.Queue(maxsize=queue_chunks)
        self._io_error: str | None = None
        path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = open(path, "wb")  # noqa: SIM115 - closed by the writer thread
        self._fh.write(wav_header(0))
        self._thread = threading.Thread(target=self._run, name=f"wav-{path.stem}", daemon=True)
        self._thread.start()

    def write(self, chunk: bytes) -> bool:
        """Hand one chunk to the writer thread. Never blocks."""
        if self.failed or self.capped:
            return False
        if self._queued + len(chunk) > self.max_bytes:
            self.capped = True
            log.info("recording %s reached its %.0f min cap; later audio is not kept",
                     self.path.name, self.max_bytes / BYTES_PER_SECOND / 60)
            return False
        try:
            self._q.put_nowait(chunk)
        except queue.Full:
            self.failed = True
            log.warning("recording %s: disk fell behind, dropping this recording (speech is unaffected)",
                        self.path.name)
            return False
        self._queued += len(chunk)
        return True

    def close(self) -> WavResult | None:
        """Finish the file. Returns None (and removes the file) when the recording failed."""
        self._put_sentinel()
        self._thread.join(JOIN_TIMEOUT_S)
        if self._thread.is_alive():
            self.failed = True
            log.warning("recording %s: writer did not finish in time; dropping it", self.path.name)
        if self._io_error is not None:
            self.failed = True
            log.warning("recording %s: write failed (%s); dropping it", self.path.name, self._io_error)
        if self.failed:
            self.path.unlink(missing_ok=True)
            return None
        return WavResult(self.path, self._written)

    def _put_sentinel(self) -> None:
        while True:
            try:
                self._q.put(None, timeout=JOIN_TIMEOUT_S)
                return
            except queue.Full:  # the thread is stuck: give up on this file
                self.failed = True
                return

    def _run(self) -> None:
        try:
            while True:
                chunk = self._q.get()
                if chunk is None:
                    break
                self._fh.write(chunk)
                self._written += len(chunk)
            self._fh.seek(0)
            self._fh.write(wav_header(self._written))
        except OSError as exc:
            self._io_error = type(exc).__name__
        finally:
            try:
                self._fh.close()
            except OSError as exc:
                self._io_error = self._io_error or type(exc).__name__
