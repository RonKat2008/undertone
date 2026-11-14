"""Late /ws joiners get the current state as contract events."""
from backend.bus import Bus
from backend.contracts import parse_event
from backend.snapshot import Snapshot

POLICY = {"focus_rule_id": "interrupt", "budget_per_session": 5, "min_gap_s": 60, "tolerance": 0.3, "silent": False}


def ev(d):
    return parse_event(d)


def test_snapshot_replays_current_session_in_order():
    s = Snapshot(Bus())
    s.add(ev({"type": "band.status", "connected": True, "transport": "sim", "battery_pct": 80, "mic_on": False}))
    s.add(ev({"type": "session.started", "session_id": "s1", "coach_id": "core", "mode": "regular",
              "policy": POLICY, "ts": 0}))
    s.add(ev({"type": "turn.final", "turn_id": "t1", "speaker": "me", "text": "hi", "start": 0.5, "end": 1.0,
              "wpm": 120, "fillers": []}))
    s.add(ev({"type": "bookmark", "source": "phone", "text": None, "ts": 0.8}))
    s.add(ev({"type": "band.status", "connected": True, "transport": "sim", "battery_pct": 79, "mic_on": True}))
    types = [e.type for e in s.events()]
    assert types == ["band.status", "session.started", "bookmark", "turn.final"]
    assert s.events()[0].battery_pct == 79
    s.add(ev({"type": "session.ended", "session_id": "s1"}))
    assert [e.type for e in s.events()][-1] == "session.ended"
    s.add(ev({"type": "session.started", "session_id": "s2", "coach_id": "core", "mode": "regular",
              "policy": POLICY, "ts": 0}))
    assert [e.type for e in s.events()] == ["band.status", "session.started"]  # the new session starts clean


def test_nothing_before_a_session():
    s = Snapshot(Bus())
    s.add(ev({"type": "turn.final", "turn_id": "t1", "speaker": "me", "text": "hi", "start": 0.5, "end": 1.0,
              "wpm": 120, "fillers": []}))
    assert s.events() == []
