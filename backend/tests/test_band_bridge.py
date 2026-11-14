"""Person A's band wired into the Brain via attach_band(), on the kit's sim band, no network."""
import asyncio
import importlib.util
import os
import sys
import types


def _stub_module(name):
    """Stand-in for a package this machine lacks (CI without deps). Never used where it is installed."""
    if name in sys.modules:
        return
    try:
        if importlib.util.find_spec(name) is not None:
            return
    except (ModuleNotFoundError, ValueError):
        pass
    m = types.ModuleType(name)

    class _Any:
        def __init__(self, *a, **k):
            pass

        def __getattr__(self, k):
            return _Any()

        def __call__(self, *a, **k):
            return _Any()

    m.__getattr__ = lambda k: _Any
    sys.modules[name] = m
    if "." in name:
        parent = name.rsplit(".", 1)[0]
        _stub_module(parent)
        setattr(sys.modules[parent], name.rsplit(".", 1)[1], m)


def _stub_fastapi_if_missing():
    for name in ("httpx", "dotenv", "google.genai"):
        _stub_module(name)
    if "fastapi" in sys.modules or importlib.util.find_spec("fastapi") is not None:
        return
    m = types.ModuleType("fastapi")

    class APIRouter:
        def __init__(self, *a, **k):
            pass

        def __getattr__(self, name):  # .get/.post/.put/.delete/.websocket -> no-op decorator
            return lambda *a, **k: (lambda fn: fn)

    class HTTPException(Exception):
        def __init__(self, status_code=500, detail=None, **k):
            super().__init__(detail)
            self.status_code, self.detail = status_code, detail

    m.APIRouter, m.HTTPException = APIRouter, HTTPException
    m.Depends = m.Query = m.Body = m.Path = lambda *a, **k: None
    m.Request = m.WebSocket = object
    sys.modules["fastapi"] = m


def test_double_tap_runs_a_brain_session(tmp_path, monkeypatch):
    _stub_fastapi_if_missing()
    monkeypatch.setenv("BAND_TRANSPORT", "sim")
    monkeypatch.setenv("USE_PIPECAT", "false")
    monkeypatch.setenv("KEYBOARD_TAPS", "0")
    import backend.motion.classifier as cl
    monkeypatch.setattr(cl, "CAL_DIR", tmp_path)

    from backend import studio
    from backend.brain import Brain
    from backend.bus import Bus
    from backend.config import settings
    from backend.db import DB
    from backend.session import attach_band
    from backend.state import AppState

    async def run():
        db = DB(str(tmp_path / "t.db"))
        state = AppState(bus=Bus(), db=db, active_coach=studio.default_coach())
        brain = Brain(state, settings)
        seen = []

        async def grab(ev):
            seen.append(ev)

        state.bus.on("*", grab)
        band = await attach_band(state, brain)
        band.band.tap("double")
        await asyncio.sleep(1.5)
        assert state.session is not None and band.running
        assert band.session_id == state.session.session_id
        t = 0.5
        script = [("me", "So um I basically wanted to ask about the internship, you know, and the team."),
                  ("other", "Sure, what do you want to know?"),
                  ("me", "What does a normal week look like for an intern?")]
        for i, (spk, text) in enumerate(script):
            n = len(text.split())
            band._on_hearing_event({"type": "turn.final", "turn_id": "t%d" % (i + 1), "speaker": spk,
                                    "text": text, "start": t, "end": t + n * 0.35, "wpm": 170.0,
                                    "fillers": ["um", "basically", "you know"] if i == 0 else []})
            t += n * 0.35 + 0.5
            await asyncio.sleep(0.2)
        band.band.tap("single")
        await asyncio.sleep(0.5)
        band.band.tap("double")
        for _ in range(40):
            await asyncio.sleep(0.25)
            if any(e.type == "debrief" for e in seen):
                break
        await state.bus.drain()
        await band.shutdown()
        db.close()
        return seen

    seen = asyncio.run(run())
    types_seen = [e.type for e in seen]
    for want in ("band.status", "session.started", "turn.final", "motion", "status.reply", "session.ended", "debrief"):
        assert want in types_seen, (want, sorted(set(types_seen)))
    assert types_seen.count("session.started") == 1  # the Brain announces it, the band does not


def test_scripted_speech_runs_the_real_path(tmp_path, monkeypatch):
    """STT=fake: the sample conversation flows through Hearing -> turns -> Brain -> debrief."""
    _stub_fastapi_if_missing()
    monkeypatch.setenv("BAND_TRANSPORT", "sim")
    monkeypatch.setenv("STT", "fake")
    monkeypatch.setenv("STT_FAKE_SPEED", "12")
    monkeypatch.setenv("KEYBOARD_TAPS", "0")
    import backend.motion.classifier as cl
    monkeypatch.setattr(cl, "CAL_DIR", tmp_path)

    from backend import studio
    from backend.brain import Brain
    from backend.bus import Bus
    from backend.config import settings
    from backend.db import DB
    from backend.session import attach_band
    from backend.state import AppState

    async def run():
        db = DB(str(tmp_path / "f.db"))
        state = AppState(bus=Bus(), db=db, active_coach=studio.default_coach())
        brain = Brain(state, settings)
        seen = []

        async def grab(ev):
            seen.append(ev)

        state.bus.on("*", grab)
        band = await attach_band(state, brain)
        band.band.tap("double")
        await asyncio.sleep(6.5)  # ~58 s of script at 12x
        band.band.tap("double")
        for _ in range(40):
            await asyncio.sleep(0.25)
            if any(e.type == "debrief" for e in seen):
                break
        await state.bus.drain()
        await band.shutdown()
        db.close()
        return seen

    seen = asyncio.run(run())
    turns = [e for e in seen if e.type == "turn.final"]
    assert len(turns) >= 8, [t.text for t in turns]
    assert {t.speaker for t in turns} == {"me", "other"}
    assert turns[0].speaker == "me" and turns[0].fillers == ["um"]
    assert any(e.type == "transcript.partial" for e in seen)
    debrief = next(e for e in seen if e.type == "debrief")
    assert debrief.data.numbers.talk_ratio > 0.3


def test_demo_script_fires_the_interrupt_nudge(tmp_path, monkeypatch):
    """fixtures/demo_script.jsonl: the wearer cuts in, the Brain buzzes `interrupt`, the debrief names it."""
    _stub_fastapi_if_missing()
    monkeypatch.setenv("BAND_TRANSPORT", "sim")
    monkeypatch.setenv("STT", "fake")
    monkeypatch.setenv("STT_FAKE_SPEED", "10")
    monkeypatch.setenv("STT_FAKE_SCRIPT", "fixtures/demo_script.jsonl")
    monkeypatch.setenv("KEYBOARD_TAPS", "0")
    import backend.motion.classifier as cl
    monkeypatch.setattr(cl, "CAL_DIR", tmp_path)

    from backend import studio
    from backend.brain import Brain
    from backend.bus import Bus
    from backend.config import settings
    from backend.db import DB
    from backend.session import attach_band
    from backend.state import AppState

    async def run():
        db = DB(str(tmp_path / "d.db"))
        state = AppState(bus=Bus(), db=db, active_coach=studio.default_coach())
        brain = Brain(state, settings)
        seen = []

        async def grab(ev):
            seen.append(ev)

        state.bus.on("*", grab)
        band = await attach_band(state, brain)
        band.band.tap("double")
        await asyncio.sleep(8.5)
        band.band.tap("double")
        for _ in range(40):
            await asyncio.sleep(0.25)
            if any(e.type == "debrief" for e in seen):
                break
        await state.bus.drain()
        await band.shutdown()
        db.close()
        return seen

    seen = asyncio.run(run())
    me = [e for e in seen if e.type == "turn.final" and e.speaker == "me"]
    assert len(me) == 3  # the overlap is one long turn, not fragments
    assert any(e.type == "nudge" and e.haptic == "interrupt" for e in seen)
    debrief = next(e for e in seen if e.type == "debrief")
    assert debrief.data.numbers.interruptions >= 1


def test_practice_round_buzzes_every_crutch_word(tmp_path, monkeypatch):
    """Practice mode: each 'um' / 'basically' of the wearer is a filler buzz within ~1 s,
    published as the nudge the dashboard's practice panel counts."""
    _stub_fastapi_if_missing()
    monkeypatch.setenv("BAND_TRANSPORT", "sim")
    monkeypatch.setenv("STT", "fake")
    monkeypatch.setenv("STT_FAKE_SPEED", "10")
    monkeypatch.setenv("STT_FAKE_SCRIPT", "fixtures/demo_script.jsonl")
    monkeypatch.setenv("KEYBOARD_TAPS", "0")
    import backend.motion.classifier as cl
    monkeypatch.setattr(cl, "CAL_DIR", tmp_path)

    from backend import haptics_port, studio
    from backend.brain import Brain
    from backend.bus import Bus
    from backend.config import settings
    from backend.db import DB
    from backend.session import attach_band
    from backend.state import AppState

    buzzes = []

    async def sender(cmd):
        buzzes.append(cmd.pattern)

    async def run():
        haptics_port.register_sender(sender)
        db = DB(str(tmp_path / "p.db"))
        state = AppState(bus=Bus(), db=db, active_coach=studio.default_coach())
        brain = Brain(state, settings)
        seen = []

        async def grab(ev):
            seen.append(ev)

        state.bus.on("*", grab)
        band = await attach_band(state, brain)
        await brain.start_session(mode="practice")
        await asyncio.sleep(8.5)
        coach_words = list(state.session.coach.filler_words)
        await brain.end_session()
        await asyncio.sleep(0.5)
        await state.bus.drain()
        await band.shutdown()
        haptics_port.reset_sender()
        db.close()
        return seen, coach_words

    seen, coach_words = asyncio.run(run())
    crutch = [e for e in seen if e.type == "nudge" and e.rule_id == "crutch"]
    from backend.stt.fillers import find_fillers
    said = []
    for e in seen:
        if e.type == "turn.final" and e.speaker == "me":
            said += find_fillers(e.text.split(), coach_words)
    assert said, "the demo script has crutch words"
    assert len(crutch) == len(said), ([c.reason for c in crutch], said)
    assert all(c.haptic == "filler" and c.reason.startswith("You said “") for c in crutch)
    assert all(c.latency_ms < 1500 for c in crutch)
    assert buzzes.count("filler") >= len(crutch)


def test_pace_nudge_fires_mid_answer(tmp_path, monkeypatch):
    """A fast answer buzzes slow_down while it is still going, from live Deepgram-word pace."""
    _stub_fastapi_if_missing()
    monkeypatch.setenv("BAND_TRANSPORT", "sim")
    monkeypatch.setenv("STT", "fake")
    monkeypatch.setenv("STT_FAKE_SPEED", "1")
    monkeypatch.setenv("STT_FAKE_SCRIPT", "fixtures/fast_answer.jsonl")
    monkeypatch.setenv("KEYBOARD_TAPS", "0")
    import backend.motion.classifier as cl
    monkeypatch.setattr(cl, "CAL_DIR", tmp_path)

    from backend import studio
    from backend.brain import Brain
    from backend.bus import Bus
    from backend.config import settings
    from backend.db import DB
    from backend.session import attach_band
    from backend.state import AppState

    async def run():
        db = DB(str(tmp_path / "pace.db"))
        state = AppState(bus=Bus(), db=db, active_coach=studio.default_coach())
        brain = Brain(state, settings)
        seen = []

        async def grab(ev):
            seen.append((time.monotonic(), ev))

        state.bus.on("*", grab)
        band = await attach_band(state, brain)
        await brain.start_session()
        await asyncio.sleep(7.5)
        await brain.end_session()
        for _ in range(40):
            await asyncio.sleep(0.25)
            if any(e.type == "debrief" for _, e in seen):
                break
        await state.bus.drain()
        await band.shutdown()
        db.close()
        return seen

    import time
    seen = asyncio.run(run())
    pace = [t for t, e in seen if e.type == "nudge" and e.rule_id == "pace"]
    turn = [t for t, e in seen if e.type == "turn.final"]
    assert pace, [e.type for _, e in seen]
    assert not turn or pace[0] < turn[0]  # buzzed before the answer was over
