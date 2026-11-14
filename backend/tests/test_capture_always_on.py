"""Always-on wiring: a conversation's recording starts at its first turn (pre-buffer) and its
verdict is stored when it closes (rules here: tests have no Gemini key)."""

from __future__ import annotations

import wave
from pathlib import Path

import pytest

from backend.capture.media import recordings_dir
from backend.tests.test_always_on import _close, _hear, _settle, _setup, rig, turn  # noqa: F401

CHUNK = 2560
CHUNK_S = 0.08


def stream(band, seconds: float, level: int) -> None:
    """Push `seconds` of audio through the band's chunk tap, advancing its clock."""
    sample = int(level).to_bytes(2, "little", signed=True)
    for _ in range(round(seconds / CHUNK_S)):
        band.audio_seconds = round(band.audio_seconds + CHUNK_S, 6)
        band.chunk_tap(sample * (CHUNK // 2), band.audio_seconds)


async def test_recording_starts_at_first_turn_and_verdict_is_stored(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=2)
    assert ctl.recorder is not None and band.chunk_tap is not None
    stream(band, 10.0, 0)  # background silence before anyone speaks
    stream(band, 4.0, 4000)  # first turn: 10.0 - 12.0 on the stream clock, final at 14 s
    long_text = "we should plan the launch for next week with the whole team and the partners"
    await _hear(ctl, state, turn(1, 10.0, text=long_text))
    sid = state.session.session_id
    stream(band, 6.0, 4000)
    await _hear(ctl, state, turn(2, 14.0, "other", long_text), turn(3, 17.0, text=long_text),
                turn(4, 19.0, "other", long_text))
    clock.advance(61)
    await ctl.always_on.tick()
    await _settle(state)
    if getattr(brain, "_keep_task", None) is not None:
        await brain._keep_task
    await _settle(state)

    row = rig.get_session(sid)
    assert (row["kept"], row["kept_reason"], row["kept_source"]) == (1, "keep", "rules")
    assert row["audio_offset_s"] == pytest.approx(0.5, abs=CHUNK_S)
    path = recordings_dir(Path(rig.path)) / f"{sid}.wav"
    with wave.open(str(path), "rb") as w:
        frames = w.readframes(w.getnframes())
        duration = w.getnframes() / w.getframerate()
    assert duration == pytest.approx(20.0 - 9.5, abs=2 * CHUNK_S)
    first_loud = next(i for i in range(0, len(frames), 2) if frames[i:i + 2] != b"\x00\x00") / 2 / 16000
    assert first_loud == pytest.approx(row["audio_offset_s"], abs=CHUNK_S)  # opening words are in the file
    await _close(ctl, state, brain)


async def test_short_capture_is_trivial_and_hidden(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=4)
    stream(band, 2.0, 3000)
    await _hear(ctl, state, turn(1, 0.0))
    sid = state.session.session_id
    clock.advance(61)
    await ctl.always_on.tick()
    await _settle(state)
    row = rig.get_session(sid)
    assert (row["kept"], row["kept_reason"], row["kept_source"]) == (0, "trivial", "rules")
    assert row["audio_s"] is not None  # trivial keeps its audio; only noise/sensitive lose it
    assert sid not in [r["session_id"] for r in rig.list_sessions(kept_only=True)]
    await _close(ctl, state, brain)


async def test_record_audio_off(rig, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    monkeypatch.setenv("RECORD_AUDIO", "0")
    state, brain, ctl, band, clock, seen = await _setup(rig)
    assert ctl.recorder is None and getattr(band, "chunk_tap", None) is None
    await _close(ctl, state, brain)
