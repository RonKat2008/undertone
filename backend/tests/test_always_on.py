"""ALWAYS_ON=1: mic on at connect, conversations open on the first turn and close on silence.

A fake band (no kit, no network) and a fake clock drive SessionController + Brain + Bus + DB,
so nothing sleeps for the silence window.
"""
from __future__ import annotations

import asyncio
import dataclasses
from pathlib import Path
from typing import Any

import pytest

from backend import config, studio
from backend.always_on import AlwaysOn, AlwaysOnConfig, SilenceTimer, settle_all
from backend.band.audio import LoudnessTimeline
from backend.band.source import BandSource
from backend.brain import Brain
from backend.bus import Bus
from backend.db import DB
from backend.session import attach_band, band_status_body
from backend.state import AppState


class FakeClock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t

    def advance(self, s: float) -> None:
        self.t += s


class FakeBand:
    """Just enough of BandSource for SessionController."""

    def __init__(self) -> None:
        self.emit = None
        self.number = 13
        self.transport = "sim"
        self.pcm_q: asyncio.Queue = asyncio.Queue()
        self.motion_q: asyncio.Queue = asyncio.Queue()
        self.tap_q: asyncio.Queue = asyncio.Queue()
        self.loudness = LoudnessTimeline()
        self.audio_seconds = 0.0
        self.mic_on = False
        self.mic_calls: list[bool] = []
        self.resets = 0
        self.connected = True
        self.chunk_tap = None

    async def start(self) -> None:
        pass

    async def stop(self) -> None:
        await self.mic(False)

    async def mic(self, on: bool) -> None:
        self.mic_calls.append(on)
        self.mic_on = on

    def reset_clock(self) -> None:
        self.resets += 1
        self.audio_seconds = 0.0

    def reset_wall_clock(self, seconds_ago: float = 0.0) -> None:
        pass

    def now(self) -> float:
        return self.audio_seconds

    def status_event(self) -> dict:
        return {"type": "band.status", "connected": self.connected, "transport": "sim", "battery_pct": None,
                "mic_on": self.mic_on}

    def tap(self, kind: str) -> None:
        self.tap_q.put_nowait(kind)


def turn(i: int, start: float, speaker: str = "me", text: str = "So I wanted to ask about the team.") -> dict:
    return {"type": "turn.final", "turn_id": "t%d" % i, "speaker": speaker, "text": text,
            "start": start, "end": start + 2.0, "wpm": 150.0, "fillers": []}


PARTIAL = {"type": "transcript.partial", "speaker": "other", "text": "and then"}


@pytest.fixture
def rig(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    import backend.motion.classifier as cl
    monkeypatch.setattr(cl, "CAL_DIR", tmp_path)
    monkeypatch.setenv("USE_PIPECAT", "false")
    db = DB(tmp_path / "ao.db")
    yield db
    db.close()


async def _setup(db: DB, always_on: bool = True, min_turns: int = 4, silence_s: float = 60.0,
                 rejoin_s: float = 0.0):
    settings = dataclasses.replace(config.settings, always_on=always_on, always_on_silence_s=silence_s,
                                   always_on_min_turns=min_turns, always_on_rejoin_s=rejoin_s)
    state = AppState(bus=Bus(), db=db, active_coach=studio.default_coach())
    brain = Brain(state, settings)
    seen: list[Any] = []

    async def grab(ev: Any) -> None:
        seen.append(ev)

    state.bus.on("*", grab)
    clock, band = FakeClock(), FakeBand()
    ctl = await attach_band(state, brain, band=band, clock=clock)
    return state, brain, ctl, band, clock, seen


async def _settle(state: AppState) -> None:
    for _ in range(5):
        await asyncio.sleep(0.01)
        await settle_all()
        await state.bus.drain()


async def _hear(ctl, state, *events: dict) -> None:
    for ev in events:
        ctl._on_hearing_event(ev)
    await _settle(state)


async def _close(ctl, state, brain) -> None:
    await ctl.shutdown()
    await _settle(state)
    if getattr(brain, "_audio_task", None) is not None:
        await brain._audio_task


# ---------- unit: timer ----------

def test_silence_timer_uses_injected_clock() -> None:
    clock = FakeClock()
    t = SilenceTimer(60, clock)
    clock.advance(59.9)
    assert not t.expired()
    t.touch()
    clock.advance(59.9)
    assert not t.expired()
    clock.advance(0.1)
    assert t.expired()


def test_settings_default_off() -> None:
    assert config.settings.always_on is False
    assert config.settings.always_on_silence_s == 60.0 and config.settings.always_on_min_turns == 4


# ---------- integration with SessionController + Brain ----------

async def test_mic_on_at_connect_without_a_tap(rig: DB) -> None:
    state, brain, ctl, band, clock, seen = await _setup(rig)
    assert band.mic_on and band.mic_calls == [True]
    assert state.session is None and not ctl.running
    assert band_status_body(ctl)["always_on"] is True
    await _close(ctl, state, brain)


async def test_first_final_turn_opens_a_session_and_is_included(rig: DB) -> None:
    state, brain, ctl, band, clock, seen = await _setup(rig)
    band.audio_seconds = 312.0
    await _hear(ctl, state, PARTIAL, turn(1, 300.0), turn(2, 303.0, "other"))
    assert state.session is not None and ctl.session_id == state.session.session_id
    assert [t.turn_id for t in state.session.turns] == ["t1", "t2"]
    first = state.session.turns[0]
    assert first.start == 0.0 and first.end == 2.0  # rebased to session time
    assert [t.turn_id for t in rig.load_turns(state.session.session_id)] == ["t1", "t2"]
    assert [e.type for e in seen].count("session.started") == 1
    assert band.mic_calls == [True]  # never toggled by the session
    await _close(ctl, state, brain)


async def test_silence_window_closes_and_speech_resets_it(rig: DB) -> None:
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1)
    await _hear(ctl, state, turn(1, 0.0))
    sid = state.session.session_id
    clock.advance(50)
    await _hear(ctl, state, PARTIAL)          # a partial resets the timer
    clock.advance(50)
    await ctl.always_on.tick()
    assert state.session is not None
    await _hear(ctl, state, turn(2, 10.0))    # so does a final turn
    clock.advance(59)
    await ctl.always_on.tick()
    assert state.session is not None
    clock.advance(1)
    await ctl.always_on.tick()
    await _settle(state)
    assert state.session is None and not ctl.running
    assert any(e.type == "session.ended" and e.session_id == sid for e in seen)
    assert band.mic_on and band.mic_calls == [True]  # mic stays on between conversations
    await _close(ctl, state, brain)


async def test_short_capture_ends_quietly(rig: DB) -> None:
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=4)
    await _hear(ctl, state, turn(1, 0.0), turn(2, 3.0, "other"), turn(3, 6.0))
    sid = state.session.session_id
    clock.advance(61)
    await ctl.always_on.tick()
    await _settle(state)
    types = [e.type for e in seen]
    assert "session.ended" in types and "debrief" not in types
    row = rig.get_session(sid)
    assert row["ended_at"] is not None and row["summary_json"] is None and row["metrics_json"]
    assert rig.load_debrief(sid) is None
    assert len(rig.load_turns(sid)) == 3  # transcript kept
    await _close(ctl, state, brain)


async def test_long_capture_gets_normal_debrief(rig: DB) -> None:
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=4)
    await _hear(ctl, state, *[turn(i, i * 3.0, "me" if i % 2 else "other") for i in range(1, 5)])
    sid = state.session.session_id
    clock.advance(61)
    await ctl.always_on.tick()
    await _settle(state)
    assert any(e.type == "debrief" and e.session_id == sid for e in seen)
    assert rig.load_debrief(sid) is not None and rig.get_session(sid)["summary_json"]
    await _close(ctl, state, brain)


async def test_next_turn_after_close_opens_a_new_conversation(rig: DB) -> None:
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1)
    await _hear(ctl, state, turn(1, 0.0))
    first = state.session.session_id
    clock.advance(61)
    await ctl.always_on.tick()
    await _settle(state)
    band.audio_seconds = 500.0
    await _hear(ctl, state, turn(2, 490.0))
    assert state.session is not None and state.session.session_id != first
    assert state.session.turns[0].start == 0.0
    await _close(ctl, state, brain)


async def test_double_tap_closes_open_conversation_with_debrief(rig: DB) -> None:
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=4)
    await _hear(ctl, state, turn(1, 0.0))
    sid = state.session.session_id
    band.tap("double")
    await _settle(state)
    for _ in range(20):
        if any(e.type == "debrief" for e in seen):
            break
        await asyncio.sleep(0.05)
    assert state.session is None
    assert any(e.type == "debrief" and e.session_id == sid for e in seen)  # forced: debrief even if short
    await _close(ctl, state, brain)


async def test_double_tap_with_nothing_open_is_harmless(rig: DB) -> None:
    state, brain, ctl, band, clock, seen = await _setup(rig)
    band.tap("double")
    await _settle(state)
    assert state.session is None and not ctl.running and band.mic_on
    assert not any(e.type in ("session.started", "session.ended") for e in seen)
    await _close(ctl, state, brain)


async def test_single_tap_unchanged(rig: DB) -> None:
    state, brain, ctl, band, clock, seen = await _setup(rig)
    await _hear(ctl, state, turn(1, 0.0))
    band.tap("single")
    await _settle(state)
    assert any(e.type == "status.reply" for e in seen)
    await _close(ctl, state, brain)


async def test_flag_off_keeps_tap_to_start(rig: DB) -> None:
    state, brain, ctl, band, clock, seen = await _setup(rig, always_on=False)
    assert ctl.always_on is None and not band.mic_on and band.mic_calls == []
    assert band_status_body(ctl)["always_on"] is False
    await _hear(ctl, state, turn(1, 0.0))
    assert state.session is None  # no auto-open
    band.tap("double")
    await _settle(state)
    assert state.session is not None and band.mic_on
    band.tap("double")
    await _settle(state)
    assert state.session is None and not band.mic_on
    await _close(ctl, state, brain)


# ---------- Deepgram supervision ----------

class FakeHearing:
    def __init__(self) -> None:
        self.running = True
        self.stopped = False

    async def start(self) -> None:
        pass

    async def stop(self) -> None:
        self.stopped = True


async def test_dead_speech_pipeline_is_restarted(rig: DB) -> None:
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1)
    made: list[FakeHearing] = []

    def factory(coach: dict, end_on_failure: bool = False) -> FakeHearing:
        assert end_on_failure  # always-on asks Pipecat to end a worker whose STT gave up
        made.append(FakeHearing())
        return made[-1]

    ctl.use_pipecat = True
    ctl.stt = "deepgram"
    ctl._new_hearing = factory  # type: ignore[method-assign]
    await ctl.always_on.tick()
    assert len(made) == 1 and ctl.hearing is made[0]
    await _hear(ctl, state, turn(1, 0.0))
    made[0].running = False                 # Deepgram gave up
    clock.advance(11)                       # past the restart backoff
    await ctl.always_on.tick()
    await _settle(state)
    assert made[0].stopped and len(made) == 2 and ctl.hearing is made[1]
    assert state.session is None            # the open conversation was closed first
    resets = band.resets
    await ctl.always_on.tick()              # healthy: nothing happens
    assert len(made) == 2 and band.resets == resets
    await _close(ctl, state, brain)


# ---------- reconnect ----------

class FakeKitBand:
    def __init__(self) -> None:
        self.configs: list[dict] = []

    async def set_motion(self, **kw: Any) -> None:
        pass

    async def configure(self, **kw: Any) -> None:
        self.configs.append(kw)


async def test_mic_is_reenabled_after_reconnect() -> None:
    src = BandSource("sim", 13, keyboard=False)
    src.band = FakeKitBand()
    await src.mic(True)
    await src._on_link(False)          # band dropped: it forgets every setting
    await src._on_reconnected()
    assert src.band.configs[-1]["audio"] is True and src.connected


async def test_always_on_unit_holds_events_until_open() -> None:
    class Host:
        running = False
        delivered: list[dict] = []

        def listening_ok(self) -> bool:
            return True

        async def ensure_listening(self) -> None:
            pass

        def deliver(self, ev: dict) -> None:
            self.delivered.append(ev)

    host = Host()
    offsets: list[float] = []

    async def open_conv() -> None:
        await asyncio.sleep(0.01)
        host.running = True
        offsets.append(ao.begin(9.0))  # the controller joins: t=0 is the first turn's start

    async def close_conv(quiet: bool, park: bool = False) -> None:
        host.running = False

    ao = AlwaysOn(host, open_conv, close_conv, AlwaysOnConfig(silence_s=5, min_turns=1), clock=FakeClock())
    assert ao.intercept(PARTIAL) is False          # partials alone never open a conversation
    assert ao.intercept(turn(1, 4.0)) is True
    assert ao.intercept(PARTIAL) is True           # held while opening
    await asyncio.sleep(0.05)
    assert [e["type"] for e in host.delivered] == ["turn.final", "transcript.partial"]
    assert offsets == [4.0] and ao.begin(9.0) == 9.0
    await ao.stop()
