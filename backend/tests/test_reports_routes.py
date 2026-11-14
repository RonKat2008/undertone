"""Report routes over a real SQLite file: every endpoint, kept-only, merged topics, 404s, empty
database, contract round-trips, and no LLM call on any report GET."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from backend import contracts as c
from backend.bus import Bus
from backend.contracts import BookmarkEvent, DebriefNumbers, Person
from backend.db import DB
from backend.graph import _aliases, _closing, _topics
from backend.graph._cache import save_topics
from backend.growth._writer import SessionSpec, write_session
from backend.reports import router
from backend.state import AppState
from backend.studio.default import default_coach

NOW = datetime.now(timezone.utc)
ENDPOINTS: dict[str, type[BaseModel]] = {
    "/reports/overview": c.OverviewReport, "/reports/by-person": c.ByPersonReport,
    "/reports/person/alex": c.PersonReport, "/reports/person/person:sam": c.PersonReport,
    "/reports/by-topic": c.ByTopicReport, "/reports/topic/coffee-place": c.TopicReport,
    "/reports/topic/topic:product-roadmap": c.TopicReport, "/reports/habits": c.HabitsReport,
    "/reports/promises": c.PromisesReport,
}


def _write(db: DB, sid: str, days_ago: float, person: str | None, topics: tuple[str, ...], inter: int = 2,
           nudges: tuple[tuple[str, bool], ...] = (), wearer: tuple[str, ...] = ("We talked about coffee.",)) -> None:
    numbers = DebriefNumbers(talk_ratio=0.6, interruptions=inter, questions=2, fillers_per_min=2.0, wpm=150)
    write_session(db, SessionSpec(session_id=sid, started_at=NOW - timedelta(days=days_ago), numbers=numbers,
                                  person_id=person, wearer_texts=wearer, other_texts=("Mm.",), nudges=nudges,
                                  if_then="When they pause, count one breath."))
    save_topics(db, sid, topics, "llm")


@pytest.fixture
def db(tmp_path: Path) -> Iterator[DB]:
    database = DB(tmp_path / "r.db")
    database.save_person(Person(person_id="alex", name="Alex"))
    database.save_person(Person(person_id="sam", name="Sam"))
    _write(database, "s1", 0.1, "sam", ("coffee place",), inter=4, nudges=(("interrupt", True),) * 3)
    _write(database, "s2", 1, "sam", ("coffee shop", "product roadmap"), inter=4, nudges=(("interrupt", True),) * 3)
    _write(database, "s3", 2, "sam", ("roadmap",), inter=4)
    _write(database, "s4", 3, "alex", ("roadmap",), wearer=("The roadmap slipped.", "I'll send the deck tomorrow."))
    database.save_bookmark("s4", BookmarkEvent(source="promise", text="I'll send the deck tomorrow.", ts=300.0))
    _write(database, "s5", 4, "alex", ("reading",))
    _write(database, "s6", 5, "alex", ("reading habits",))
    _write(database, "noise", 1, "alex", ("secret noise topic",), inter=40)
    database.set_verdict("noise", False, "background tv", "rules")
    yield database
    database.close()


def _client(db: DB) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.state.app = AppState(bus=Bus(), db=db, active_coach=default_coach())
    return TestClient(app)


@pytest.fixture
def client(db: DB, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    async def forbidden(prompt: str, schema: type, **kwargs: object) -> object:
        raise AssertionError("report GETs must not call the LLM")

    for module in (_topics, _aliases, _closing):
        monkeypatch.setattr(module, "generate_structured", forbidden)
    return _client(db)


@pytest.mark.parametrize("path", sorted(ENDPOINTS))
def test_every_endpoint_round_trips_its_contract(client: TestClient, path: str) -> None:
    res = client.get(path)
    assert res.status_code == 200, res.text
    body = res.json()
    model = ENDPOINTS[path].model_validate(body)
    assert model.model_dump(mode="json") == body
    assert body["window"]["days"] == 30 and body["graph_focus"]["node_ids"][0] == "me"


def test_only_kept_conversations_count(client: TestClient) -> None:
    overview = client.get("/reports/overview").json()
    assert overview["totals"]["conversations"] == 6
    topics = {t["label"] for t in client.get("/reports/by-topic").json()["topics"]}
    assert "secret noise topic" not in topics
    assert client.get("/reports/topic/secret-noise-topic").status_code == 404


def test_topics_are_merged_through_the_reports(client: TestClient) -> None:
    topics = {t["topic_id"]: t for t in client.get("/reports/by-topic").json()["topics"]}
    assert set(topics) == {"coffee-place", "product-roadmap", "reading"}  # the first-cached wording wins
    assert topics["coffee-place"]["conversations"] == 2  # "coffee shop" merged
    assert topics["product-roadmap"]["conversations"] == 3  # "roadmap" merged
    assert topics["reading"]["conversations"] == 2  # "reading habits" merged


def test_person_and_topic_details(client: TestClient) -> None:
    sam = client.get("/reports/person/sam").json()
    assert sam["person"]["conversations"] == 3
    assert sam["person"]["sentence"] == (
        "You interrupt Sam twice as often as in your other conversations (4 against 2 a conversation).")
    alex = client.get("/reports/person/person:alex").json()
    assert alex["promises"][0]["quote"] == "I'll send the deck tomorrow."
    assert alex["promises"][0]["due_day"] is not None and alex["person"]["open_promises"] == 1
    roadmap = client.get("/reports/topic/product-roadmap").json()
    assert roadmap["quotes"] and all("roadmap" in q["text"].lower() for q in roadmap["quotes"])
    habits = client.get("/reports/habits").json()["habits"]
    assert habits[0]["habit"]["rule_id"] == "interrupt" and habits[0]["habit"]["total"] == 6
    assert habits[0]["if_then"] == ["When they pause, count one breath."]
    promises = client.get("/reports/promises").json()
    assert promises["counts"]["made"] == 1 and promises["open"][0]["person_name"] == "Alex"


def test_unknown_ids_are_404_and_days_is_validated(client: TestClient) -> None:
    assert client.get("/reports/person/nobody").status_code == 404
    assert client.get("/reports/topic/nothing").status_code == 404
    assert client.get("/reports/overview?days=0").status_code == 422
    assert client.get("/reports/overview?days=366").status_code == 422
    assert len(client.get("/reports/overview?days=3").json()["series"]) == 3


def test_empty_database(tmp_path: Path) -> None:
    db = DB(tmp_path / "empty.db")
    client = _client(db)
    overview = c.OverviewReport.model_validate(client.get("/reports/overview").json())
    assert overview.totals.conversations == 0 and overview.insufficient_data is True
    assert [h.kind for h in overview.highlights] == ["insufficient_data"]
    assert len(overview.series) == 30 and all(p.wpm is None for p in overview.series)
    for path in ("/reports/by-person", "/reports/by-topic", "/reports/habits", "/reports/promises"):
        body = client.get(path).json()
        assert body["graph_focus"] == {"node_ids": ["me"], "edges": []}
    assert client.get("/reports/person/alex").status_code == 404
    db.close()
