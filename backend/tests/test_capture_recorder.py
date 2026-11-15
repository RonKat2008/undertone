"""WAV writer, pre-buffered recorder and media-cap pruning (backend/capture)."""

from __future__ import annotations

import os
import queue
import time
import wave
from pathlib import Path

import pytest

from backend.capture import wav as wav_mod
from backend.capture.media import CaptureSettings, plan_prune, prune, recording_path
from backend.capture.recorder import CHUNK_S, PRE_ROLL_S, PREBUFFER_S, Recorder, RecordingInfo
from backend.capture.wav import BYTES_PER_SECOND, WavWriter, wav_header

CHUNK_BYTES = 2560


def chunk(value: int) -> bytes:
    return int(value).to_bytes(2, "little", signed=True) * (CHUNK_BYTES // 2)


def settings(tmp: Path, **kw: object) -> CaptureSettings:
    return CaptureSettings(enabled=True, directory=tmp, max_total_bytes=10**9, **kw)  # type: ignore[arg-type]


def feed_seconds(rec: Recorder, start_s: float, seconds: float, value_at=lambda t: 100) -> float:
    t = start_s
    for _ in range(round(seconds / CHUNK_S)):
        t = round(t + CHUNK_S, 6)
        rec.feed(chunk(value_at(t)), t)
    return t


def samples(path: Path) -> list[int]:
    with wave.open(str(path), "rb") as w:
        raw = w.readframes(w.getnframes())
    return [int.from_bytes(raw[i:i + 2], "little", signed=True) for i in range(0, len(raw), 2)]


# ---------- WAV writer ----------
def test_header_is_standard_pcm() -> None:
    h = wav_header(32000)
    assert len(h) == 44 and h[:4] == b"RIFF" and h[8:12] == b"WAVE"
    assert int.from_bytes(h[4:8], "little") == 36 + 32000
    assert int.from_bytes(h[24:28], "little") == 16000 and int.from_bytes(h[40:44], "little") == 32000


def test_writer_produces_readable_wav(tmp_path: Path) -> None:
    w = WavWriter(tmp_path / "a.wav", max_bytes=10**7)
    for _ in range(25):
        assert w.write(chunk(7))
    result = w.close()
    assert result is not None and result.duration_s == pytest.approx(2.0)
    with wave.open(str(tmp_path / "a.wav"), "rb") as f:
        assert (f.getframerate(), f.getnchannels(), f.getsampwidth()) == (16000, 1, 2)
        assert f.getnframes() == 25 * CHUNK_BYTES // 2


def test_writer_stops_at_cap(tmp_path: Path) -> None:
    w = WavWriter(tmp_path / "c.wav", max_bytes=CHUNK_BYTES * 3)
    took = [w.write(chunk(1)) for _ in range(5)]
    assert took == [True, True, True, False, False] and w.capped
    result = w.close()
    assert result is not None and result.data_bytes == CHUNK_BYTES * 3


def test_full_queue_drops_recording_without_blocking(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    w = WavWriter(tmp_path / "slow.wav", max_bytes=10**7, queue_chunks=2)
    gate = queue.Queue()
    real_get = w._q.get

    def slow_get(*a, **k):  # the disk "stalls" until released
        gate.get()
        return real_get(*a, **k)

    monkeypatch.setattr(w._q, "get", slow_get)
    t0 = time.perf_counter()
    results = [w.write(chunk(1)) for _ in range(10)]
    assert time.perf_counter() - t0 < 0.1  # never blocks
    assert w.failed and results.count(True) <= 3
    for _ in range(20):
        gate.put(None)
    assert w.close() is None
    assert not (tmp_path / "slow.wav").exists()


# ---------- recorder ----------
def test_prebuffer_starts_file_just_before_first_turn(tmp_path: Path) -> None:
    infos: list[RecordingInfo] = []
    rec = Recorder(settings(tmp_path), on_finished=infos.append)
    # 0-10 s silence, speech from 10 s; the conversation opens at 14 s with t=0 at 10.0
    end = feed_seconds(rec, 0.0, 14.0, lambda t: 0 if t <= 10.0 else 5000)
    offset = rec.begin("s-1", 10.0)
    end = feed_seconds(rec, end, 2.0, lambda t: 5000)
    info = rec.end("s-1")
    assert info is not None and infos == [info]
    assert offset == pytest.approx(PRE_ROLL_S, abs=CHUNK_S)
    assert info.duration_s == pytest.approx(16.0 - (10.0 - offset), abs=CHUNK_S)
    data = samples(info.path)
    speech_at = next(i for i, v in enumerate(data) if v == 5000) / 16000
    assert speech_at == pytest.approx(offset, abs=CHUNK_S)  # turn start + offset = speech in file


def test_prebuffer_is_bounded(tmp_path: Path) -> None:
    rec = Recorder(settings(tmp_path))
    feed_seconds(rec, 0.0, PREBUFFER_S + 30)
    assert len(rec._buf) == int(PREBUFFER_S / CHUNK_S)


def test_long_first_turn_keeps_its_opening_words(tmp_path: Path) -> None:
    """A 60 s monologue before the first turn is final still starts the file at t=0."""
    rec = Recorder(settings(tmp_path))
    feed_seconds(rec, 0.0, 10.0, value_at=lambda t: 0)
    feed_seconds(rec, 10.0, 62.0, value_at=lambda t: 5000)   # one turn from 10 s to 72 s
    assert rec.begin("s-long", 10.0) == pytest.approx(PRE_ROLL_S, abs=CHUNK_S)


def test_offset_is_true_when_t0_is_older_than_the_prebuffer(tmp_path: Path) -> None:
    rec = Recorder(settings(tmp_path))
    end = feed_seconds(rec, 0.0, PREBUFFER_S + 30)
    offset = rec.begin("s-older", 10.0)
    assert offset == pytest.approx(10.0 - (end - PREBUFFER_S), abs=CHUNK_S)  # negative, not 0
    assert offset < 0


def test_clock_reset_clears_prebuffer(tmp_path: Path) -> None:
    rec = Recorder(settings(tmp_path))
    feed_seconds(rec, 0.0, 5.0)
    rec.feed(chunk(1), 0.08)  # clock restarted
    assert len(rec._buf) == 1


def test_manual_session_after_clear_has_zero_offset(tmp_path: Path) -> None:
    rec = Recorder(settings(tmp_path))
    feed_seconds(rec, 0.0, 5.0)
    rec.clear()
    assert rec.begin("s-2", 0.0) == 0.0
    feed_seconds(rec, 0.0, 1.0)
    info = rec.end()
    assert info is not None and info.offset_s == 0.0 and info.duration_s == pytest.approx(1.0, abs=CHUNK_S)


def test_disabled_or_unsafe_id_records_nothing(tmp_path: Path) -> None:
    off = Recorder(CaptureSettings(enabled=False, directory=tmp_path, max_total_bytes=10**9))
    assert off.begin("s-3", 0.0) is None and off.end() is None
    rec = Recorder(settings(tmp_path))
    assert rec.begin("../evil", 0.0) is None
    assert list(tmp_path.iterdir()) == []


def test_file_cap_in_minutes(tmp_path: Path) -> None:
    rec = Recorder(settings(tmp_path, max_file_s=1.0))
    rec.begin("s-4", 0.0)
    feed_seconds(rec, 0.0, 3.0)
    info = rec.end()
    assert info is not None and info.duration_s == pytest.approx(1.0, abs=CHUNK_S)


def test_end_for_other_session_is_ignored(tmp_path: Path) -> None:
    rec = Recorder(settings(tmp_path))
    rec.begin("s-5", 0.0)
    assert rec.end("s-other") is None and rec.active_session == "s-5"
    assert rec.end("s-5") is not None


def test_on_finished_failure_does_not_raise(tmp_path: Path) -> None:
    def boom(_: RecordingInfo) -> None:
        raise RuntimeError("db gone")

    rec = Recorder(settings(tmp_path), on_finished=boom)
    rec.begin("s-6", 0.0)
    feed_seconds(rec, 0.0, 0.5)
    assert rec.end() is not None


# ---------- media cap ----------
def test_plan_prune_deletes_oldest_first() -> None:
    files = [("new.wav", 30.0, 100), ("old.wav", 10.0, 100), ("mid.wav", 20.0, 100)]
    assert plan_prune(files, 150) == ["old.wav", "mid.wav"]
    assert plan_prune(files, 300) == []
    assert plan_prune(files, 150, keep=frozenset({"old.wav"})) == ["mid.wav", "new.wav"]


def test_prune_on_disk(tmp_path: Path) -> None:
    for i, name in enumerate(("a", "b", "c")):
        p = tmp_path / f"{name}.wav"
        p.write_bytes(b"x" * 1000)
        os.utime(p, (1000 + i, 1000 + i))
    assert prune(tmp_path, 2000) == ["a.wav"]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["b.wav", "c.wav"]


def test_recording_ends_prune_the_folder(tmp_path: Path) -> None:
    old = tmp_path / "s-old.wav"
    old.write_bytes(b"x" * (BYTES_PER_SECOND * 2))
    os.utime(old, (1, 1))
    rec = Recorder(CaptureSettings(enabled=True, directory=tmp_path, max_total_bytes=BYTES_PER_SECOND * 2))
    rec.begin("s-new", 0.0)
    feed_seconds(rec, 0.0, 1.0)
    assert rec.end() is not None
    assert not old.exists() and (tmp_path / "s-new.wav").exists()


def test_recording_path_rejects_traversal(tmp_path: Path) -> None:
    assert recording_path(tmp_path, "s-20261114-1-ab12") == tmp_path / "s-20261114-1-ab12.wav"
    for bad in ("../x", "a/b", "", "a.wav", "x" * 81):
        assert recording_path(tmp_path, bad) is None


def test_queue_size_holds_the_prebuffer() -> None:
    assert wav_mod.DEFAULT_QUEUE_CHUNKS > PREBUFFER_S / CHUNK_S
