"""GET /sessions/{id}/debrief on a bare FastAPI app (no lifespan, no network)."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.config import FIXTURES_DIR
from backend.contracts import Debrief
from backend.db import DB
from backend.debrief import router


@pytest.fixture
def client(tmp_path: Path) -> Iterator[tuple[TestClient, DB]]:
    db = DB(tmp_path / "r.db")
    app = FastAPI()
    app.state.app = SimpleNamespace(db=db)
    app.include_router(router)
    with TestClient(app) as c:
        yield c, db
    db.close()


def _example() -> Debrief:
    return Debrief.model_validate(json.loads((FIXTURES_DIR / "debrief_example.json").read_text()))


def test_returns_stored_debrief_and_audio_url(client: tuple[TestClient, DB]) -> None:
    c, db = client
    db.save_debrief("s1", _example(), "/media/s1.mp3")
    r = c.get("/sessions/s1/debrief")
    assert r.status_code == 200
    body = r.json()
    assert body["session_id"] == "s1"
    assert body["audio_url"] == "/media/s1.mp3"
    assert Debrief.model_validate(body["data"]) == _example()


def test_audio_url_may_be_null(client: tuple[TestClient, DB]) -> None:
    c, db = client
    db.save_debrief("s2", _example(), None)
    assert c.get("/sessions/s2/debrief").json()["audio_url"] is None


def test_unknown_session_is_404(client: tuple[TestClient, DB]) -> None:
    c, _ = client
    r = c.get("/sessions/nope/debrief")
    assert r.status_code == 404
    assert "nope" in r.text
