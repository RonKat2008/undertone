"""CrutchWatcher: dedupe of interim revisions, multi-word crutches, the once-per-round success."""
import asyncio
from types import SimpleNamespace

from backend.practice import CrutchWatcher
from backend.stt.turns import Word


class FakeBus:
    def __init__(self):
        self.events = []

    async def publish(self, ev):
        self.events.append(ev)


def _round(w, clock, mode="practice"):
    return w.on_started(SimpleNamespace(mode=mode, session_id="s"))


def test_dedupes_interims_and_finds_multiword():
    async def go():
        t = [0.0]
        app = SimpleNamespace(bus=FakeBus(), session=SimpleNamespace(coach=SimpleNamespace(filler_words=["um", "you know"])))
        w = CrutchWatcher(app, clock=lambda: t[0])
        await _round(w, t)
        w.on_words("me", [Word("um", 1.0, 1.2, 0)], now=1.5)
        w.on_words("me", [Word("Um,", 1.02, 1.22, 0), Word("so", 1.3, 1.5, 0)], now=1.8)  # same um, revised
        w.on_words("other", [Word("um", 2.0, 2.2, 1)], now=2.4)                            # not the wearer
        w.on_words("me", [Word("you", 3.0, 3.1, 0), Word("know", 3.15, 3.3, 0)], now=3.6)
        await asyncio.sleep(0)
        return w, app.bus.events

    w, events = asyncio.run(go())
    assert w.count == 2
    assert [e["reason"] for e in events] == ["You said “um”", "You said “you know”"]
    assert events[0]["latency_ms"] == 300


def test_success_once_when_round_is_cleaner():
    async def go():
        t = [0.0]
        app = SimpleNamespace(bus=FakeBus(), session=SimpleNamespace(coach=SimpleNamespace(filler_words=["um"])))
        w = CrutchWatcher(app, clock=lambda: t[0])
        await _round(w, t)
        for i in range(5):
            w.on_words("me", [Word("um", i * 2.0, i * 2.0 + 0.2, 0)], now=i * 2.0 + 0.5)
        t[0] = 20.0
        await w.on_ended(SimpleNamespace(session_id="s"))
        t[0] = 30.0
        await _round(w, t)
        w.on_words("me", [Word("um", 1.0, 1.2, 0)], now=1.5)
        t[0] = 40.0
        w.check_success(10.0)   # only 10 s of a 20 s round: too early
        t[0] = 47.0
        w.check_success(17.0)
        w.check_success(18.0)   # once
        await asyncio.sleep(0)
        return app.bus.events

    events = asyncio.run(go())
    assert [e["rule_id"] for e in events].count("round_improved") == 1
    assert events[-1]["haptic"] == "success"


def test_regular_mode_is_untouched():
    async def go():
        app = SimpleNamespace(bus=FakeBus(), session=SimpleNamespace(coach=SimpleNamespace(filler_words=["um"])))
        w = CrutchWatcher(app)
        await w.on_started(SimpleNamespace(mode="regular", session_id="s"))
        w.on_words("me", [Word("um", 1.0, 1.2, 0)], now=1.5)
        await asyncio.sleep(0)
        return app.bus.events

    assert asyncio.run(go()) == []
