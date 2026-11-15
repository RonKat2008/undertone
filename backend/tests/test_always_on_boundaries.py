"""Always-on conversation boundaries under real-world timing (fake clock, scripted events).

What the first day on the real band showed: conversations fragmenting, a new one opening while
the previous one was still closing, and a turn that lands during the close being dropped.
Each test scripts one of those sequences against SessionController + Brain + Bus + DB.
"""
from __future__ import annotations

import asyncio
from typing import Any

import pytest

from backend import brain as brain_mod
from backend.tests.test_always_on import (  # noqa: F401
    PARTIAL, _close, _hear, _settle, _setup, rig, turn,
)


def _types(seen: list[Any]) -> list[str]:
    return [e.type for e in seen]


def _lifecycle(seen: list[Any]) -> list[tuple[str, str]]:
    return [(e.type, e.session_id) for e in seen if e.type in ("session.started", "session.ended")]


def _gate_debrief(monkeypatch: pytest.MonkeyPatch) -> asyncio.Event:
    """Debrief generation waits for the returned event (a slow LLM call)."""
    gate = asyncio.Event()
    orig = brain_mod.debrief_pkg.generate_debrief

    async def slow(*a: Any, **k: Any):
        await gate.wait()
        return await orig(*a, **k)

    monkeypatch.setattr(brain_mod.debrief_pkg, "generate_debrief", slow)
    return gate


async def _until(cond, tries: int = 100) -> None:
    for _ in range(tries):
        if cond():
            return
        await asyncio.sleep(0.01)


# ---------- a turn heard just before / during a close ----------

async def test_turn_heard_just_before_a_tap_close_stays_in_that_conversation(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1)
    await _hear(ctl, state, turn(1, 0.0))
    sid = state.session.session_id
    ctl._on_hearing_event(turn(2, 3.0, "other"))  # Deepgram delivers it ...
    await ctl.always_on.close(reason="double-tap")  # ... in the same instant as the tap
    await _settle(state)
    assert [t.turn_id for t in rig.load_turns(sid)] == ["t1", "t2"]
    await _close(ctl, state, brain)


async def test_turn_during_a_close_opens_the_next_conversation_after_it(rig, monkeypatch) -> None:  # noqa: F811
    gate = _gate_debrief(monkeypatch)
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1)
    band.audio_seconds = 5.0
    await _hear(ctl, state, turn(1, 0.0))
    first = state.session.session_id
    hook = brain.before_end

    async def speech_mid_close() -> None:   # someone starts talking while the close runs
        band.audio_seconds = 40.0
        ctl._on_hearing_event(turn(2, 40.0))
        await asyncio.sleep(0.01)
        assert state.session is not None and state.session.session_id == first  # nothing opened yet
        await hook()

    brain.before_end = speech_mid_close
    await ctl.always_on.close(reason="double-tap")
    await _until(lambda: state.session is not None)
    second = state.session.session_id
    assert rig.load_debrief(first) is None   # the next one opened without waiting for the debrief
    gate.set()
    await _settle(state)
    assert second != first
    life = _lifecycle(seen)
    assert life.index(("session.ended", first)) < life.index(("session.started", second))
    assert [t.turn_id for t in rig.load_turns(second)] == ["t2"]  # not dropped
    assert rig.load_turns(second)[0].start == 0.0  # and its t=0 is its own first turn
    assert rig.get_session(first)["ended_at"] <= rig.get_session(second)["started_at"]
    await _close(ctl, state, brain)


async def test_one_conversation_is_one_session(rig) -> None:  # noqa: F811
    """Speech with pauses just under the window never splits the conversation."""
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1, silence_s=60)
    t = 0.0
    for i in range(1, 8):
        band.audio_seconds = t + 2.0
        await _hear(ctl, state, turn(i, t))
        clock.advance(59.5)
        t += 59.5
        await ctl.always_on.tick()
    await _settle(state)
    assert _types(seen).count("session.started") == 1 and "session.ended" not in _types(seen)
    assert len(state.session.turns) == 7
    await _close(ctl, state, brain)


# ---------- the phone's Start / Stop during always-on ----------

async def test_phone_stop_then_speech_opens_a_fresh_conversation(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1)
    await _hear(ctl, state, turn(1, 0.0))
    first = state.session.session_id
    await brain.end_session()          # POST /session/stop
    await _settle(state)
    assert not ctl.running and ctl.always_on.phase == "idle"
    band.audio_seconds = 20.0
    await _hear(ctl, state, turn(2, 15.0))
    assert state.session is not None and state.session.session_id != first
    assert ctl.session_id == state.session.session_id
    await _close(ctl, state, brain)


async def test_phone_start_while_a_turn_opens_one_leaves_no_orphan(rig, monkeypatch) -> None:  # noqa: F811
    gate = _gate_debrief(monkeypatch)
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1)
    await _hear(ctl, state, turn(1, 0.0))
    first = state.session.session_id
    phone = asyncio.ensure_future(brain.start_session())   # POST /session/start: ends `first`
    await asyncio.sleep(0.05)
    band.audio_seconds = 12.0
    ctl._on_hearing_event(turn(2, 10.0))                    # speech during its debrief
    await asyncio.sleep(0.05)
    gate.set()
    await phone
    await _settle(state)
    await _until(lambda: ctl.always_on.phase == "open")
    rows = rig.list_sessions(limit=10)
    open_rows = [r["session_id"] for r in rows if r["ended_at"] is None]
    assert open_rows == [state.session.session_id]          # exactly one open, the live one
    assert ctl.session_id == state.session.session_id
    assert len(rows) == 2 and state.session.session_id != first
    assert [t.turn_id for t in rig.load_turns(state.session.session_id)] == ["t2"]
    await _close(ctl, state, brain)


async def test_phone_start_during_always_on_is_adopted(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1)
    band.audio_seconds = 50.0
    sid = await brain.start_session()
    await _settle(state)
    assert ctl.session_id == sid and ctl.always_on.phase == "open"
    await _hear(ctl, state, turn(1, 51.0))
    assert [t.turn_id for t in state.session.turns] == ["t1"]
    assert state.session.turns[0].start == pytest.approx(1.0)
    await _close(ctl, state, brain)


# ---------- double-tap ----------

async def test_double_tap_during_speech_then_speech_again(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=4)
    await _hear(ctl, state, turn(1, 0.0), turn(2, 3.0, "other"))
    first = state.session.session_id
    band.tap("double")
    await _until(lambda: state.session is None and ctl.always_on.phase == "idle")
    await _settle(state)
    assert rig.load_debrief(first) is not None          # a tap always gets its debrief
    band.audio_seconds = 9.0
    await _hear(ctl, state, turn(3, 7.0))
    assert state.session.session_id != first
    await _close(ctl, state, brain)


# ---------- rejoin: a pause just over the window ----------

async def test_speech_within_rejoin_grace_continues_the_conversation(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1, silence_s=60, rejoin_s=20)
    await _hear(ctl, state, turn(1, 0.0))
    sid = state.session.session_id
    clock.advance(61)
    await ctl.always_on.tick()
    await _settle(state)
    assert state.session is None and ctl.always_on.parked == sid
    assert rig.load_debrief(sid) is None                     # held back during the grace period
    clock.advance(10)
    band.audio_seconds = 73.0
    await _hear(ctl, state, turn(2, 71.0, "other"))
    assert state.session is not None and state.session.session_id == sid
    assert ctl.session_id == sid and ctl.always_on.parked is None
    assert [t.turn_id for t in rig.load_turns(sid)] == ["t1", "t2"]
    assert rig.load_turns(sid)[1].start == pytest.approx(71.0)  # same t=0 as before the pause
    assert rig.get_session(sid)["ended_at"] is None
    assert _types(seen).count("debrief") == 0
    clock.advance(61)
    await ctl.always_on.tick()
    clock.advance(21)
    await ctl.always_on.tick()
    await _settle(state)
    assert rig.load_debrief(sid) is not None and rig.get_session(sid)["ended_at"] is not None
    assert len(rig.list_sessions(limit=10)) == 1
    await _close(ctl, state, brain)


async def test_speech_after_rejoin_grace_opens_a_new_one_and_debriefs_the_old(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1, silence_s=60, rejoin_s=20)
    await _hear(ctl, state, turn(1, 0.0))
    first = state.session.session_id
    clock.advance(61)
    await ctl.always_on.tick()
    clock.advance(21)
    band.audio_seconds = 90.0
    await _hear(ctl, state, turn(2, 85.0))   # before the 1 Hz tick noticed the grace ran out
    await _until(lambda: rig.load_debrief(first) is not None)
    assert state.session is not None and state.session.session_id != first
    assert rig.load_debrief(first) is not None
    await _close(ctl, state, brain)


async def test_tap_after_a_silence_close_finishes_it_now(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1, silence_s=60, rejoin_s=20)
    await _hear(ctl, state, turn(1, 0.0))
    sid = state.session.session_id
    clock.advance(61)
    await ctl.always_on.tick()
    await ctl.always_on.close(reason="double-tap")
    await _settle(state)
    assert ctl.always_on.parked is None and rig.load_debrief(sid) is not None
    await _close(ctl, state, brain)


async def test_shutdown_finishes_a_parked_conversation(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1, silence_s=60, rejoin_s=20)
    await _hear(ctl, state, turn(1, 0.0))
    sid = state.session.session_id
    clock.advance(61)
    await ctl.always_on.tick()
    await _close(ctl, state, brain)
    assert rig.load_debrief(sid) is not None


# ---------- reconnect mid-conversation ----------

async def test_band_reconnect_mid_conversation_keeps_one_session(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1)
    await _hear(ctl, state, turn(1, 0.0))
    sid = state.session.session_id
    band.connected = False                  # Bluetooth drops ...
    clock.advance(5)
    await ctl.always_on.tick()
    band.connected = True                   # ... and the kit reconnects
    band.audio_seconds = 12.0
    await _hear(ctl, state, turn(2, 10.0))
    assert state.session.session_id == sid and _types(seen).count("session.started") == 1
    await _close(ctl, state, brain)


# ---------- the speech pipeline restarting ----------

class FlushingHearing:
    """A dead Deepgram worker that still hands over its last turn when stopped."""

    def __init__(self, ctl, flush: dict | None) -> None:
        self.ctl, self.flush, self.running = ctl, flush, True

    async def start(self) -> None:
        pass

    async def stop(self) -> None:
        if self.flush is not None:
            self.ctl._on_hearing_event(self.flush)


async def test_last_words_of_a_dead_pipeline_stay_in_their_conversation(rig) -> None:  # noqa: F811
    state, brain, ctl, band, clock, seen = await _setup(rig, min_turns=1)
    made: list[FlushingHearing] = []

    def factory(coach: dict, end_on_failure: bool = False) -> FlushingHearing:
        made.append(FlushingHearing(ctl, turn(9, 20.0) if not made else None))
        return made[-1]

    ctl.stt = "deepgram"
    ctl._new_hearing = factory  # type: ignore[method-assign]
    await ctl.always_on.tick()
    band.audio_seconds = 3.0
    await _hear(ctl, state, turn(1, 0.0))
    sid = state.session.session_id
    made[0].running = False
    clock.advance(11)
    await ctl.always_on.tick()
    await _settle(state)
    assert [t.turn_id for t in rig.load_turns(sid)] == ["t1", "t9"]
    assert state.session is None and len(rig.list_sessions(limit=10)) == 1  # no stray conversation
    await _close(ctl, state, brain)
