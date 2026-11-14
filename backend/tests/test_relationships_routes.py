"""Relationship routes over a temporary database (TestClient, the app's error envelope, no keys)."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.bus import Bus
from backend.contracts import DebriefNumbers, PersonRelationship, Relationship
from backend.db import DB
from backend.growth._writer import SessionSpec, write_session
from backend.relationships import examples as ex
from backend.state import AppState
from backend.studio.default import default_coach


def _write(db: DB, sid: str, pid: str, lines: ex.Lines) -> None:
    write_session(db, SessionSpec(
        session_id=sid, started_at=datetime(2026, 11, 10, tzinfo=timezone.utc), person_id=pid,
        numbers=DebriefNumbers(talk_ratio=0.5, interruptions=0, questions=1, fillers_per_min=0, wpm=150),
        wearer_texts=tuple(t for s, t in lines if s == "me"),
        other_texts=tuple(t for s, t in lines if s == "other")))


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    from backend.main import app  # the real app: router mounted, error envelope installed

    db = DB(tmp_path / "routes.db")
    from backend.growth._people import tag_session
    _write(db, "s1", "alex", ex.FRIEND)
    tag_session(db, "s1", "Alex", "alex")
    previous = getattr(app.state, "app", None)
    app.state.app = AppState(bus=Bus(), db=db, active_coach=default_coach())
    yield TestClient(app)  # no `with`: the lifespan (band, real db) never runs
    app.state.app = previous
    db.close()


def test_list_has_every_person_with_a_placeholder(client: TestClient) -> None:
    body = client.get("/relationships").json()
    assert len(body) == 1
    row = PersonRelationship.model_validate(body[0])
    assert (row.person_id, row.name, row.sessions) == ("alex", "Alex", 1)
    assert row.relationship.kind == "unknown" and row.relationship.updated_at is None
    # the listing scheduled a background refresh of stale people (rules here: no key in tests)
    again = PersonRelationship.model_validate(client.get("/relationships").json()[0])
    assert again.relationship.kind == "friend" and again.relationship.source == "rules"


def test_get_refresh_put_delete(client: TestClient) -> None:
    r = client.get("/people/alex/relationship")
    assert r.status_code == 200
    r = client.post("/people/alex/relationship/refresh")
    assert r.status_code == 200
    rel = Relationship.model_validate(r.json())
    assert rel.source == "rules" and rel.kind == "friend" and rel.based_on_sessions == 1
    r = client.put("/people/alex/relationship", json={"kind": "partner"})
    assert r.status_code == 200 and r.json()["kind"] == "partner" and r.json()["source"] == "user"
    assert r.json()["confidence"] == 1
    assert client.get("/people/alex/relationship").json()["source"] == "user"
    assert client.get("/relationships").json()[0]["relationship"]["kind"] == "partner"
    r = client.delete("/people/alex/relationship")
    assert r.status_code == 200 and r.json()["source"] != "user"


@pytest.mark.parametrize("method,path,body", [
    ("get", "/people/nobody/relationship", None),
    ("post", "/people/nobody/relationship/refresh", None),
    ("put", "/people/nobody/relationship", {"kind": "friend"}),
    ("delete", "/people/nobody/relationship", None),
])
def test_unknown_person_is_404(client: TestClient, method: str, path: str, body: dict | None) -> None:
    r = client.request(method, path, json=body)
    assert r.status_code == 404
    assert r.json()["ok"] is False and r.json()["error"]["code"] == "http_404"


@pytest.mark.parametrize("body", [{"kind": "enemy"}, {}, {"kind": "friend", "extra": 1}, {"kind": 3}])
def test_bad_body_is_422(client: TestClient, body: dict) -> None:
    r = client.put("/people/alex/relationship", json=body)
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_request"


def test_overlong_id_is_rejected(client: TestClient) -> None:
    assert client.get("/people/" + "x" * 200 + "/relationship").status_code == 422
