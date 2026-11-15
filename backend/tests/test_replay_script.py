"""scripts/replay.py reads both fixture formats in fixtures/ (flat and {"at", "event"} wrapped)."""

from __future__ import annotations

import importlib.util
from pathlib import Path

from backend.contracts import parse_event

ROOT = Path(__file__).resolve().parents[2]


def _replay():
    spec = importlib.util.spec_from_file_location("replay_script", ROOT / "scripts" / "replay.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_flat_fixture_loads_valid_events() -> None:
    events = _replay().load_events(ROOT / "fixtures" / "demo_session.jsonl")
    assert len(events) == 105
    for at, ev in events:
        assert isinstance(at, float) and "at" not in ev
        parse_event(ev)


def test_wrapped_fixture_is_unwrapped_and_lifecycle_events_skipped() -> None:
    events = _replay().load_events(ROOT / "fixtures" / "sample_conversation.jsonl")
    types = {ev["type"] for _, ev in events}
    assert "turn.final" in types and "motion" in types
    # the replay owns the session: the fixture's own start/end would fight /session/start|stop
    assert not types & {"session.started", "session.ended"}
    for _, ev in events:
        parse_event(ev)


def test_stt_script_fixtures_replay() -> None:
    events = _replay().load_events(ROOT / "fixtures" / "demo_regular.jsonl")
    assert [ev["turn_id"] for _, ev in events] == [f"t{i}" for i in range(1, 9)]
    assert events[0][0] == 7.1
