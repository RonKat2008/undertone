"""Transcript, audio (Range) and keep-override routes; kept-only filters in /sessions, growth, graph."""

from __future__ import annotations

import time
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.bus import Bus
from backend.capture import routes as capture_routes
from backend.capture.media import recordings_dir
from backend.capture.wav import wav_header
from backend.contracts import DebriefNumbers, SessionSummary, SessionTranscript, TurnFinalEvent
from backend.db import DB
from backend.graph._load import load_input
from backend.growth import router as growth_router
from backend.growth._fading import next_session_index
from backend.growth._store import load_sessions
from backend.growth._writer import SessionSpec, write_session
from backend.state import AppState
from backend.studio.default import default_coach

NUMBERS = DebriefNumbers(talk_ratio=0.5, interruptions=0, questions=2, fillers_per_min=1.0, wpm=150)
NOW = datetime.now(timezone.utc)


def spec(sid: str, minutes_ago: int) -> SessionSpec:
    return SessionSpec(session_id=sid, started_at=NOW - timedelta(minutes=minutes_ago), numbers=NUMBERS,
                       wearer_texts=("I think we should ship it", "Yes, Friday works"),
                       other_texts=("What do you think?", "Can we do Friday?"), duration_s=60.0)


@pytest.fixture
def db(tmp_path: Path) -> Iterator[DB]:
    d = DB(tmp_path / "routes.db")
    for i, sid in enumerate(("s-keep", "s-noise", "s-legacy")):
        write_session(d, spec(sid, 30 - i))
    d.set_verdict("s-keep", True, "keep", "decisions")
    d.set_verdict("s-noise", False, "noise", "decisions")
    yield d
    d.close()


@pytest.fixture
def client(db: DB) -> TestClient:
    app = FastAPI()
    app.include_router(growth_router)
    app.include_router(capture_routes.router)
    app.state.app = AppState(bus=Bus(), db=db, active_coach=default_coach())
    return TestClient(app)


def write_wav(db: DB, sid: str, seconds: float = 2.0, offset: float = 0.5) -> bytes:
    pcm = bytes(range(256)) * int(32000 * seconds / 256)
    data = wav_header(len(pcm)) + pcm
    directory = recordings_dir(Path(db.path))
    directory.mkdir(parents=True, exist_ok=True)
    (directory / f"{sid}.wav").write_bytes(data)
    db.set_recording(sid, offset, seconds)
    return data


# ---------- transcript ----------
def test_transcript_oldest_first_with_offset(client: TestClient, db: DB) -> None:
    db.save_turn("s-keep", TurnFinalEvent(turn_id="early", speaker="me", text="Hello", start=-0.0, end=0.5,
                                          wpm=120, fillers=["um"]))
    write_wav(db, "s-keep", offset=0.48)
    body = client.get("/sessions/s-keep/transcript").json()
    model = SessionTranscript.model_validate(body)
    starts = [t.start for t in model.turns]
    assert starts == sorted(starts) and model.turns[0].turn_id == "early"
    assert model.turns[0].fillers == ["um"]
    assert body["audio_url"] == "/sessions/s-keep/audio" and body["audio_offset_s"] == 0.48
    assert body["duration_s"] == 60.0 and body["session_id"] == "s-keep"
    assert set(body["turns"][0]) == {"turn_id", "speaker", "text", "start", "end", "wpm", "fillers"}


def test_transcript_without_recording(client: TestClient) -> None:
    body = client.get("/sessions/s-legacy/transcript").json()
    assert body["audio_url"] is None and body["audio_offset_s"] == 0 and len(body["turns"]) == 4


def test_transcript_open_session_has_null_duration(client: TestClient, db: DB) -> None:
    db.create_session("s-live", "default", "Default", "regular", NOW.isoformat())
    assert client.get("/sessions/s-live/transcript").json()["duration_s"] is None


def test_transcript_404(client: TestClient) -> None:
    assert client.get("/sessions/nope/transcript").status_code == 404


# ---------- audio ----------
def test_audio_full_and_range(client: TestClient, db: DB) -> None:
    data = write_wav(db, "s-keep")
    full = client.get("/sessions/s-keep/audio")
    assert full.status_code == 200 and full.headers["content-type"] == "audio/wav"
    assert full.content == data and full.headers.get("accept-ranges") == "bytes"
    part = client.get("/sessions/s-keep/audio", headers={"Range": "bytes=100-299"})
    assert part.status_code == 206 and part.content == data[100:300]
    assert part.headers["content-range"] == f"bytes 100-299/{len(data)}"
    tail = client.get("/sessions/s-keep/audio", headers={"Range": "bytes=0-1"})
    assert tail.status_code == 206 and tail.content == b"RI"


def test_audio_404s(client: TestClient, db: DB) -> None:
    assert client.get("/sessions/s-legacy/audio").status_code == 404  # no recording
    assert client.get("/sessions/unknown/audio").status_code == 404
    assert client.get("/sessions/..%2F..%2Fetc/audio").status_code == 404
    write_wav(db, "s-noise")  # a noise capture never serves audio, even if a file is left over
    assert client.get("/sessions/s-noise/audio").status_code == 404


def test_audio_missing_file_is_404(client: TestClient, db: DB) -> None:
    db.set_recording("s-keep", 0.5, 3.0)  # metadata but the file was pruned
    assert client.get("/sessions/s-keep/audio").status_code == 404
    assert client.get("/sessions/s-keep/transcript").json()["audio_url"] is None


# ---------- /sessions ----------
def test_sessions_lists_kept_by_default(client: TestClient) -> None:
    ids = [s["session_id"] for s in client.get("/sessions").json()]
    assert ids == ["s-legacy", "s-keep"]  # newest first; legacy (no verdict) counts as kept
    every = {s["session_id"]: s for s in client.get("/sessions?include=all").json()}
    assert set(every) == {"s-keep", "s-noise", "s-legacy"}
    assert (every["s-noise"]["kept"], every["s-noise"]["kept_reason"]) == (False, "noise")
    assert every["s-legacy"]["kept"] is True and "kept_reason" not in every["s-legacy"]
    assert client.get("/sessions?include=bogus").status_code == 422


def test_sessions_carry_audio_url(client: TestClient, db: DB) -> None:
    write_wav(db, "s-keep")
    rows = {s["session_id"]: s for s in client.get("/sessions").json()}
    assert rows["s-keep"]["audio_url"] == "/sessions/s-keep/audio"
    assert "audio_url" not in rows["s-legacy"]


# ---------- override ----------
def test_user_override(client: TestClient, db: DB) -> None:
    r = client.post("/sessions/s-noise/keep", json={"kept": True})
    assert r.status_code == 200 and r.json()["kept"] is True and r.json()["kept_reason"] == "keep"
    row = db.get_session("s-noise")
    assert row is not None and (row["kept"], row["kept_source"]) == (1, "user")
    assert "s-noise" in [s["session_id"] for s in client.get("/sessions").json()]
    r = client.post("/sessions/s-keep/keep", json={"kept": False})
    assert r.json()["kept"] is False and r.json().get("kept_reason") is None  # hidden by the wearer
    assert db.get_session("s-keep")["kept_reason"] is None
    assert "s-keep" not in [s["session_id"] for s in client.get("/sessions").json()]


def test_override_validation(client: TestClient) -> None:
    assert client.post("/sessions/nope/keep", json={"kept": True}).status_code == 404
    assert client.post("/sessions/s-keep/keep", json={}).status_code == 422


def test_override_keeps_specific_reason() -> None:
    assert capture_routes.override_reason(False, "sensitive") == "sensitive"
    assert capture_routes.override_reason(False, "keep") is None
    assert capture_routes.override_reason(False, None) is None
    assert capture_routes.override_reason(False, "trivial") == "trivial"
    assert capture_routes.override_reason(True, "noise") == "keep"


def test_sensitive_transcript_is_never_served(client: TestClient, db: DB) -> None:
    db.set_verdict("s-noise", False, "sensitive", "decisions")
    assert client.get("/sessions/s-noise/transcript").status_code == 404
    assert client.get("/sessions/s-keep/transcript").status_code == 200


# ---------- growth + graph filters ----------
def test_growth_and_graph_count_only_kept(db: DB) -> None:
    assert {s.session_id for s in load_sessions(db)} == {"s-keep", "s-legacy"}
    assert next_session_index(db) == 3
    graph = load_input(db, days=7, now=time.time())
    assert {c.session_id for c in graph.conversations} == {"s-keep", "s-legacy"}


# ---------- contract ----------
def test_summary_optional_fields_round_trip() -> None:
    base = {"session_id": "s", "started_at": "2026-11-14T10:00:00Z", "duration_s": 1.0, "coach_name": "c",
            "mode": "regular", "person_id": None, "headline_fact": "", "numbers": NUMBERS.model_dump()}
    assert SessionSummary.model_validate(base).model_dump(mode="json") == base
    full = {**base, "kept": False, "kept_reason": "noise", "audio_url": "/sessions/s/audio"}
    assert SessionSummary.model_validate(full).model_dump(mode="json") == full


def test_transcript_round_trip() -> None:
    example = {"session_id": "s", "started_at": "2026-11-14T10:00:00Z", "duration_s": None, "audio_url": None,
               "audio_offset_s": 0.0, "turns": [{"turn_id": "t0", "speaker": "other", "text": "hi", "start": 0.0,
                                                  "end": 0.4, "wpm": 150.0, "fillers": []}]}
    assert SessionTranscript.model_validate(example).model_dump(mode="json") == example


def _ts_fields(name: str) -> set[str]:
    import re

    src = (Path(__file__).resolve().parents[2] / "contracts" / "events.ts").read_text()
    match = re.search(r"export interface " + name + r" \{(.*?)\n\}", src, re.S)
    assert match, f"{name} missing from events.ts"
    return set(re.findall(r"^\s+(\w+)\??:", match.group(1), re.M))


@pytest.mark.parametrize("name", ["SessionSummary", "TranscriptTurn", "SessionTranscript"])
def test_fields_match_ts(name: str) -> None:
    from backend import contracts

    assert set(getattr(contracts, name).model_fields) == _ts_fields(name)
