"""Health that tells the truth (backend/listening.py) and the failure paths around it:
no audio, speech-to-text down, flags, phantom sessions, the last words of a session, late turns,
a pipeline restart's clock, and /health itself."""
from __future__ import annotations

import asyncio
import logging
import time
from types import SimpleNamespace
from typing import Any

import httpx
import pytest

from backend import brain as brain_mod
from backend.band.audio import LoudnessTimeline
from backend.band.source import BandSource
from backend.listening import AudioWatchdog, TransitionLog, listening_report
from backend.session import SessionController
from backend.stt.pipeline import stt_error_class
from backend.tests.test_always_on import (  # noqa: F401
    FakeBand, _close, _hear, _settle, _setup, rig, turn,
)


class Clock:
    def __init__(self, t: float = 5000.0) -> None:
        self.t = t

    def __call__(self) -> float:
        return self.t


def _ctl(band: Any = None, hearing: Any = None, stt: str = "deepgram", **kw: Any) -> Any:
    band = band or SimpleNamespace(
        audio_seconds=100.0, loudness=LoudnessTimeline(), mic_on=True, last_chunk_at=4999.9,
        mic_on_since=4000.0, chunks_received=1250, dropped_chunks=0, decoder_ok=True,
        pcm_q=asyncio.Queue(), chunk_tap=None,
        status_event=lambda: {"type": "band.status", "connected": True, "transport": "ble",
                              "battery_pct": 80, "mic_on": True})
    return SimpleNamespace(band=band, hearing=hearing, stt=stt, stt_error=None, stt_started_at=4000.0,
                           last_heard_at=4999.0, session_id=None, always_on=None, running=True,
                           recorder=None, audio_watchdog=None, **kw)


def _hearing(**kw: Any) -> Any:
    base = dict(running=True, connected=True, last_error=None, last_error_at=None, last_transcript_at=4999.0)
    return SimpleNamespace(**{**base, **kw})


# ---------- the report ----------

def test_all_good_listening() -> None:
    r = listening_report(_ctl(hearing=_hearing()), clock=Clock())
    assert r["listening_ok"] is True and r["listening_reason"] is None and r["degraded"] == []
    assert r["stt"]["state"] == "up" and r["audio_arriving"] is True and r["audio_age_s"] == 0.1


def test_no_audio_from_the_band() -> None:
    ctl = _ctl(hearing=_hearing())
    ctl.band.last_chunk_at = 4988.0
    r = listening_report(ctl, clock=Clock())
    assert r["listening_ok"] is False and r["listening_reason"] == "No audio from the band for 12 s"
    assert r["audio_arriving"] is False


def test_mic_off_and_band_gone() -> None:
    ctl = _ctl(hearing=_hearing())
    ctl.band.mic_on = False
    assert listening_report(ctl, clock=Clock())["listening_reason"] == "Mic is off"
    ctl.band.status_event = lambda: {"connected": False, "transport": "ble"}
    assert listening_report(ctl, clock=Clock())["listening_reason"] == "Band is not connected"


def test_speech_to_text_rejected_is_down_with_its_class() -> None:
    ctl = _ctl(hearing=_hearing(running=False, connected=False, last_error="connection rejected (HTTP 401)",
                                last_error_at=4999.0))
    r = listening_report(ctl, clock=Clock())
    assert r["stt"]["state"] == "down"
    assert r["listening_reason"] == "Speech-to-text is down: connection rejected (HTTP 401)"


def test_speech_to_text_reconnecting_and_never_connecting() -> None:
    ctl = _ctl(hearing=_hearing(connected=False, last_error="connection lost", last_error_at=4990.0))
    assert listening_report(ctl, clock=Clock())["listening_reason"] == \
        "Speech-to-text is reconnecting: connection lost"
    ctl = _ctl(hearing=_hearing(connected=False))
    ctl.stt_started_at = 4980.0
    assert listening_report(ctl, clock=Clock())["listening_reason"] == \
        "Speech-to-text has not connected after 20 s"


def test_voice_without_words_is_flagged() -> None:
    ctl = _ctl(hearing=_hearing(last_transcript_at=4900.0))
    ctl.last_heard_at = 4900.0
    for i in range(200):
        ctl.band.loudness.add(84.0 + i * 0.08, -30.0)  # someone talking for the last 16 s
    r = listening_report(ctl, clock=Clock())
    assert r["listening_ok"] is False and r["listening_reason"].startswith("Speech-to-text is not returning words")


def test_stt_off_and_failed_start() -> None:
    assert listening_report(_ctl(stt="off"), clock=Clock())["listening_reason"] == "Speech-to-text is off (STT=off)"
    ctl = _ctl(hearing=None)
    ctl.stt_error = "no API key"
    assert listening_report(ctl, clock=Clock())["listening_reason"] == "Speech-to-text is down: no API key"


def test_judge_and_phone_problems_are_degraded_not_listening() -> None:
    r = listening_report(_ctl(hearing=_hearing()), {"judge": "decisions", "judge_fail_streak": 3,
                                                    "phones_connected": 0}, clock=Clock())
    assert r["listening_ok"] is True and len(r["degraded"]) == 2


def test_error_classes_never_carry_the_message() -> None:
    secret = "Deepgram rejected the connection (status 401): invalid credentials sk-abc123"
    assert stt_error_class(secret) == "connection rejected (HTTP 401)"
    assert "sk-" not in stt_error_class("connection error: token=sk-abc123 timed out")
    assert stt_error_class("connection failed to stay up 3 times in a row") == "connection keeps dropping"


# ---------- acting on it ----------

def test_warning_once_per_transition(caplog: pytest.LogCaptureFixture) -> None:
    tl = TransitionLog()
    bad = {"listening_ok": False, "listening_reason": "No audio from the band for 4 s"}
    worse = {"listening_ok": False, "listening_reason": "No audio from the band for 12 s"}
    good = {"listening_ok": True, "listening_reason": None}
    with caplog.at_level(logging.INFO, logger="undertone.listening"):
        for r in (good, bad, worse, worse, bad, good, good):
            tl.update(r, True, time.monotonic())
    warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
    assert len(warnings) == 1 and "No audio" in warnings[0].getMessage()
    assert any("OK again" in r.getMessage() for r in caplog.records)


def test_audio_watchdog_is_bounded_and_resets() -> None:
    wd = AudioWatchdog(stall_s=8.0, max_retries=3)
    fired = [wd.due(True, True, 8.0 + i, 100.0 + i * 8) for i in range(6)]
    assert fired == [True, True, True, False, False, False] and wd.gave_up
    assert not wd.due(True, True, 0.5, 200.0)        # audio is back: reset
    assert wd.due(True, True, 9.0, 300.0)            # a new stall may re-arm again
    assert not AudioWatchdog(stall_s=8.0).due(False, True, 99.0, 0.0)  # band gone: nothing to re-arm


async def test_watchdog_rearms_a_silent_mic(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig)
    band.mic_on_since = time.monotonic() - 30   # mic on for 30 s, not one chunk
    band.last_chunk_at = None
    calls = list(band.mic_calls)
    await ctl._health_tick()
    assert band.mic_calls[len(calls):] == [False, True] and band.mic_on
    await _close(ctl, state, brain)


# ---------- flags, phantom sessions, the mic ----------

@pytest.mark.parametrize("raw", ["1", "true", "yes", "on", "TRUE"])
def test_use_pipecat_accepts_any_true_spelling(monkeypatch: pytest.MonkeyPatch, raw: str) -> None:
    monkeypatch.delenv("STT", raising=False)
    monkeypatch.setenv("USE_PIPECAT", raw)
    assert SessionController(emit=lambda ev: None, band=FakeBand()).stt == "deepgram"
    monkeypatch.setenv("USE_PIPECAT", "0")
    assert SessionController(emit=lambda ev: None, band=FakeBand()).stt == "off"


async def test_failed_start_leaves_no_phantom_session(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("USE_PIPECAT", "false")
    band = FakeBand()

    async def broken_mic(on: bool) -> None:
        raise OSError("bluetooth write failed")

    band.mic = broken_mic  # type: ignore[method-assign]
    ctl = SessionController(emit=lambda ev: None, band=band)
    with pytest.raises(OSError):
        await ctl.start_session()
    assert ctl.session_id is None and not ctl.running


class _KitBand:
    def __init__(self, fail: bool) -> None:
        self.fail = fail

    async def configure(self, **kw: Any) -> None:
        if self.fail:
            raise OSError("not connected")


async def test_mic_state_follows_the_band_not_the_wish() -> None:
    src = BandSource("serial", 13, keyboard=False)
    src.band = _KitBand(fail=True)
    with pytest.raises(OSError):
        await src.mic(True)
    assert src.mic_on is False and src.mic_on_since is None
    src.band = _KitBand(fail=False)
    await src.mic(True)
    assert src.mic_on is True and src.mic_on_since is not None


def test_audio_arrival_is_recorded() -> None:
    src = BandSource("sim", 13, keyboard=False)
    src._push_pcm(b"\x00" * 2560)
    assert src.chunks_received == 1 and src.last_chunk_at is not None


# ---------- the last words, late turns, a restart's clock ----------

class _StopFlushHearing:
    """Deepgram-like: the final turn only comes out when the worker is stopped."""

    def __init__(self, ctl: Any, last: dict) -> None:
        self.ctl, self.last, self.running = ctl, last, True

    async def start(self) -> None:
        pass

    async def stop(self) -> None:
        self.running = False
        self.ctl._on_hearing_event(self.last)


async def test_manual_end_keeps_the_last_turn(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig, always_on=False)
    ctl.stt = "deepgram"
    ctl._new_hearing = lambda coach, end_on_failure=True: _StopFlushHearing(ctl, turn(7, 4.0))  # type: ignore
    sid = await brain.start_session()
    await _settle(state)
    assert ctl.session_id == sid
    await brain.end_session()           # POST /session/stop: the last turn is still in Deepgram
    await _settle(state)
    assert [t.turn_id for t in rig.load_turns(sid)] == ["t7"]
    await _close(ctl, state, brain)


async def test_a_turn_finished_after_a_tap_close_stays_with_its_conversation(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1)
    band.audio_seconds = 6.0
    await _hear(ctl, state, turn(1, 0.0))
    sid = state.session.session_id
    band.audio_seconds = 10.0
    await ctl.always_on.close(reason="double-tap")
    await _settle(state)
    band.audio_seconds = 11.5
    await _hear(ctl, state, turn(2, 8.5, "other"))   # spoken before the tap, finalised after it
    assert state.session is None and len(rig.list_sessions(limit=10)) == 1  # no new conversation
    assert [t.turn_id for t in rig.load_turns(sid)] == ["t1", "t2"]
    assert rig.load_turns(sid)[1].start == pytest.approx(8.5)
    await _close(ctl, state, brain)


async def test_stale_worker_events_are_ignored_and_new_times_are_right(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1)
    ctl.stt = "deepgram"
    ctl._new_hearing = lambda coach, end_on_failure=True: SimpleNamespace(  # type: ignore[method-assign]
        running=True, start=_noop, stop=_noop)
    await ctl.always_on.tick()                                  # first worker
    old_gen = ctl._hearing_gen
    band.audio_seconds = 3000.0
    await _hear(ctl, state, turn(1, 2990.0))
    ctl.hearing.running = False                                 # Deepgram died
    clock.advance(11)
    resets = band.resets
    await ctl.always_on.tick()                                  # restart: clock back to 0
    await _settle(state)
    assert band.resets == resets + 1 and ctl._hearing_gen == old_gen + 1
    ctl._on_hearing_event(turn(9, 2995.0), gen=old_gen)         # a late callback from the dead worker
    await _settle(state)
    assert state.session is None
    band.audio_seconds = 12.0
    await _hear(ctl, state, turn(2, 5.0), turn(3, 8.0, "other"))
    starts = [t.start for t in state.session.turns]
    assert starts == [0.0, 3.0]                                  # not stamped 0.0, 0.0
    await _close(ctl, state, brain)


async def _noop() -> None:
    pass


async def test_auto_opened_session_clock_starts_at_its_first_words(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1)
    band.audio_seconds = 312.0
    before = time.time()
    await _hear(ctl, state, turn(1, 300.0))   # final 12 s after it began
    assert state.session.started_at == pytest.approx(before - 12.0, abs=0.5)
    assert state.session.now_s() == pytest.approx(12.0, abs=0.5)
    await _close(ctl, state, brain)


async def test_a_failing_debrief_still_ends_the_row(rig, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    async def boom(*a: Any, **k: Any):
        raise RuntimeError("LLM down")

    monkeypatch.setattr(brain_mod.debrief_pkg, "generate_debrief", boom)
    state, brain, ctl, band, clock, seen = await _setup(rig, always_on=False)
    sid = await brain.start_session()
    await brain.end_session()
    assert rig.get_session(sid)["ended_at"] is not None
    await _close(ctl, state, brain)


async def test_stale_session_ended_never_stops_a_newer_session(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1)
    await _hear(ctl, state, turn(1, 0.0))
    live = ctl.session_id
    await state.bus.publish({"type": "session.ended", "session_id": "s-some-older-one"})
    await _settle(state)
    assert ctl.session_id == live
    await _close(ctl, state, brain)


# ---------- /health ----------

async def test_health_without_a_band_says_so() -> None:
    from backend.main import app

    life = app.router.lifespan_context(app)
    await life.__aenter__()
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            body = (await c.get("/health")).json()
    finally:
        await life.__aexit__(None, None, None)
    assert body["ok"] is True and body["band_attached"] is False
    assert body["listening_ok"] is False and body["listening_reason"].startswith("No band attached")
    assert body["session_mode"] is None and body["session_coach_id"] is None
    assert body["degraded"] and body["listening"] is None


async def test_band_diag_and_status_carry_the_picture(rig) -> None:  # noqa: F811
    from backend.session import band_diag_body, band_status_body

    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1)
    await _hear(ctl, state, turn(1, 0.0))
    diag, status = band_diag_body(ctl), band_status_body(ctl)
    for key in ("connected", "mic_on", "audio_seconds", "recent_level_db", "queued_chunks", "dropped_chunks",
                "stt", "stt_running", "session_id", "always_on"):      # what /band/diag always had
        assert key in diag
    assert diag["conversation_id"] == state.session.session_id and diag["always_on_detail"]["state"] == "open"
    assert diag["judge"] == "rules" and "listening_ok" in status and "listening_reason" in status
    await _close(ctl, state, brain)


# ---------- relationship refresh hooks ----------

async def test_keep_verdict_refreshes_the_tagged_person(rig, monkeypatch: pytest.MonkeyPatch) -> None:  # noqa: F811
    from backend import relationships

    calls: list[str] = []

    async def fake_refresh(db: Any, person_id: str, **kw: Any) -> None:
        calls.append(person_id)

    monkeypatch.setattr(relationships, "refresh_person", fake_refresh)
    state, brain, ctl, band, clock, seen = await _setup(rig, always_on=False)
    sid = await brain.start_session()
    rig.set_session_person(sid, "jordan-lee")
    await brain.end_session()
    await brain.wait_background()
    assert calls == ["jordan-lee"] and not brain._rel_tasks
    await _close(ctl, state, brain)


def test_tagging_a_person_refreshes_them(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from backend import relationships, studio
    from backend.bus import Bus
    from backend.db import DB
    from backend.growth import router
    from backend.state import AppState

    calls: list[str] = []

    async def fake_refresh(db: Any, person_id: str, **kw: Any) -> None:
        calls.append(person_id)

    monkeypatch.setattr(relationships, "refresh_person", fake_refresh)
    db = DB(tmp_path / "tag.db")
    db.create_session("s-1", "core", "Core", "regular", "2026-11-14T10:00:00+00:00")
    app = FastAPI()
    app.include_router(router)
    app.state.app = AppState(bus=Bus(), db=db, active_coach=studio.default_coach())
    r = TestClient(app).post("/sessions/s-1/person", json={"name": "Jordan Lee"})
    assert r.status_code == 200 and calls == ["jordan-lee"]
    db.close()
