"""Knowledge graph: pure building, caps, window, node detail, sample graph and the routes."""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.bus import Bus
from backend.contracts import (
    BookmarkEvent,
    BookmarkReview,
    DebriefNumbers,
    KnowledgeGraph,
    Person,
    SessionSummary,
)
from backend.db import DB
from backend.graph import _topics, router
from backend.graph._build import build_graph, cap_graph
from backend.graph._cache import load_topics, save_topics
from backend.graph._rows import Conversation, GraphInput, HabitHit, Line
from backend.growth._writer import SessionSpec, write_session
from backend.llm import LLMUnavailable
from backend.state import AppState
from backend.studio.default import default_coach

NUMBERS = DebriefNumbers(talk_ratio=0.6, interruptions=2, questions=1, fillers_per_min=2.0, wpm=150)
NOW = datetime.now(timezone.utc)


def _client(db: DB) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.state.app = AppState(bus=Bus(), db=db, active_coach=default_coach())
    return TestClient(app)


def _write(db: DB, sid: str, days_ago: float, person: str | None, topics: tuple[str, ...] | None,
           nudges: tuple[tuple[str, bool], ...] = (), wearer: tuple[str, ...] = ("I talked about the roadmap.",),
           ) -> None:
    write_session(db, SessionSpec(
        session_id=sid, started_at=NOW - timedelta(days=days_ago), numbers=NUMBERS, person_id=person,
        wearer_texts=wearer, other_texts=("Tell me more.",), nudges=nudges, duration_s=600,
        headline=f"headline {sid}"))
    if topics is not None:
        save_topics(db, sid, topics, "llm")


def _seed(db: DB) -> None:
    db.save_person(Person(person_id="alex", name="Alex"))
    db.save_person(Person(person_id="priya", name="Priya"))
    _write(db, "s1", 1, "alex", ("roadmap", "hiring"), (("interrupt", True), ("interrupt", True), ("fillers", False)),
           wearer=("The roadmap slipped.", "I'll send you the deck tonight."))
    db.save_bookmark("s1", BookmarkEvent(source="promise", text="I'll send you the deck tonight.", ts=300.0))
    db.save_bookmark("s1", BookmarkEvent(source="phone", text=None, ts=100.0))
    debrief, _ = db.load_debrief("s1")  # type: ignore[misc]
    review = BookmarkReview(ts=300.0, source="promise", snippet="deck", what_happened="You promised the deck.",
                            follow_up="Send Alex the deck")
    db.save_debrief("s1", debrief.model_copy(update={"bookmarks": [review]}), None)
    _write(db, "s2", 3, "alex", ("roadmap",), (("interrupt", False),))
    _write(db, "s3", 5, "priya", ("climbing",))
    _write(db, "s5", 1.5, None, ())
    _write(db, "s4", 40, None, ("lisbon trip",))


@pytest.fixture
def db(tmp_path: Path) -> Iterator[DB]:
    database = DB(tmp_path / "graph.db")
    _seed(database)
    yield database
    database.close()


@pytest.fixture
def client(db: DB, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    async def unavailable(prompt: str, schema: type, **kwargs: object) -> object:
        raise LLMUnavailable("tests")

    monkeypatch.setattr(_topics, "generate_structured", unavailable)
    return _client(db)


def _by_id(graph: KnowledgeGraph) -> dict[str, object]:
    return {n.id: n for n in graph.nodes}


def _edges(graph: KnowledgeGraph) -> set[tuple[str, str, str, float]]:
    return {(e.source, e.target, e.kind, e.weight) for e in graph.edges}


def test_empty_database_returns_a_real_empty_graph(tmp_path: Path) -> None:
    db = DB(tmp_path / "empty.db")
    client = _client(db)
    graph = KnowledgeGraph.model_validate(client.get("/graph").json())
    assert graph.sample is False
    assert [n.id for n in graph.nodes] == ["me"] and graph.edges == []
    assert graph.nodes[0].weight == 0 and graph.nodes[0].last_seen is None
    assert graph.stats.model_dump() == {"conversations": 0, "people": 0, "topics": 0, "minutes_spoken": 0.0,
                                        "open_commitments": 0}
    assert client.get("/graph/node/me").json()["conversations"] == []
    assert client.get("/graph/node/person:example-alex").status_code == 404
    db.close()


def test_seeded_graph_nodes_edges_and_weights(client: TestClient) -> None:
    graph = KnowledgeGraph.model_validate(client.get("/graph").json())
    assert graph.sample is False
    nodes = _by_id(graph)
    assert graph.nodes[0].id == "me" and [n.kind for n in graph.nodes].count("me") == 1
    assert {i for i in nodes if i.startswith("conversation:")} == {
        "conversation:s1", "conversation:s2", "conversation:s3", "conversation:s5"}
    assert nodes["person:alex"].weight == 2 and nodes["person:alex"].label == "Alex"
    assert nodes["person:priya"].weight == 1
    assert nodes["topic:roadmap"].weight == 2 and nodes["topic:hiring"].weight == 1
    assert nodes["habit:interrupt"].weight == 3 and nodes["habit:interrupt"].label == "Interrupting"
    assert nodes["habit:interrupt"].meta == {"rule_id": "interrupt", "buzzed": 2, "quiet": 1, "conversations": 2}
    assert nodes["habit:fillers"].weight == 1
    commitments = [n for n in graph.nodes if n.kind == "commitment"]
    assert len(commitments) == 1
    c = commitments[0]
    assert c.label == "Send Alex the deck" and c.meta["open"] is True
    assert c.meta["quote"] == "I'll send you the deck tonight."
    assert c.meta["person_id"] == "alex" and c.meta["closed_by"] is None
    made = datetime.fromtimestamp(nodes["conversation:s1"].last_seen + 300.0, tz=timezone.utc).date()
    assert c.meta["due_day"] == made.isoformat()  # "tonight"
    assert c.meta["overdue"] is True  # made a day ago, due that night, still open
    conv = nodes["conversation:s1"]
    assert conv.meta["duration_s"] == 600 and conv.meta["coach_id"] == "listener"
    assert conv.meta["headline"] == "headline s1" and conv.meta["wpm"] == 150 and conv.meta["talk_ratio"] == 0.6
    edges = _edges(graph)
    assert ("me", "person:alex", "talked_with", 2) in edges
    assert ("me", "topic:roadmap", "about", 2) in edges
    assert ("conversation:s1", "person:alex", "talked_with", 1) in edges
    assert ("conversation:s1", "topic:hiring", "about", 1) in edges
    assert ("conversation:s1", c.id, "promised", 1) in edges
    assert (c.id, "person:alex", "promised", 1) in edges
    assert ("conversation:s1", "habit:interrupt", "showed", 2) in edges
    assert graph.stats.conversations == 4 and graph.stats.people == 2 and graph.stats.topics == 3
    assert graph.stats.open_commitments == 1 and graph.stats.minutes_spoken > 0


def test_ordering_is_deterministic(client: TestClient) -> None:
    a = client.get("/graph").json()
    b = client.get("/graph").json()
    assert [n["id"] for n in a["nodes"]] == [n["id"] for n in b["nodes"]]
    assert a["edges"] == b["edges"]


def test_window_filter(client: TestClient) -> None:
    short = KnowledgeGraph.model_validate(client.get("/graph?days=2").json())
    assert {n.id for n in short.nodes if n.kind == "conversation"} == {"conversation:s1", "conversation:s5"}
    wide = KnowledgeGraph.model_validate(client.get("/graph?days=60").json())
    assert "topic:lisbon-trip" in _by_id(wide) and wide.stats.conversations == 5
    assert client.get("/graph?days=0").status_code == 422


def test_all_edges_point_at_existing_nodes(client: TestClient) -> None:
    graph = KnowledgeGraph.model_validate(client.get("/graph").json())
    ids = set(_by_id(graph))
    assert all(e.source in ids and e.target in ids for e in graph.edges)


def _conv(i: int, topics: tuple[str, ...]) -> Conversation:
    summary = SessionSummary(session_id=f"c{i}", started_at="2026-11-01T00:00:00+00:00", duration_s=60,
                             coach_name="Listener", mode="regular", headline_fact="", numbers=NUMBERS)
    return Conversation(session_id=f"c{i}", started_ts=1_000_000.0 + i, duration_s=60.0 + i, coach_id="listener",
                        person_id=f"p{i % 30}", talk_ratio=0.5, wpm=140, headline="", topics=topics,
                        habits=(HabitHit("interrupt", True, 1.0),), promises=(),
                        lines=(Line("me", "hello", 0, 1),), summary=summary)


def test_caps_keep_me_and_highest_weight() -> None:
    convs = tuple(_conv(i, (f"topic {i % 50}", "common")) for i in range(200))
    graph = build_graph(GraphInput(conversations=convs, people=(), has_any_session=True), now=2_000_000.0)
    assert len(graph.nodes) > 150
    capped = cap_graph(graph)
    assert len(capped.nodes) <= 150
    assert capped.nodes[0].id == "me"
    kept = {n.id for n in capped.nodes}
    assert "topic:common" in kept
    assert "conversation:c199" in kept and "conversation:c0" not in kept  # longest + newest win
    assert all(e.source in kept and e.target in kept for e in capped.edges)
    assert capped.stats == graph.stats
    tiny = cap_graph(graph, {"topic": 1})
    assert [n.id for n in tiny.nodes] == ["me", "topic:common"]


def test_node_detail_person(client: TestClient) -> None:
    detail = client.get("/graph/node/person:alex").json()
    assert detail["node"]["id"] == "person:alex"
    ids = [n["id"] for n in detail["neighbours"]]
    assert ids[0] == "me" and {"conversation:s1", "conversation:s2"} <= set(ids)
    assert [c["session_id"] for c in detail["conversations"]] == ["s1", "s2"]
    assert detail["conversations"][0]["person_id"] == "alex"
    assert detail["quotes"] and {q["speaker"] for q in detail["quotes"]} <= {"me", "other"}


def test_node_detail_commitment_topic_and_habit(client: TestClient) -> None:
    graph = client.get("/graph").json()
    cid = next(n["id"] for n in graph["nodes"] if n["kind"] == "commitment")
    detail = client.get(f"/graph/node/{cid}").json()
    assert detail["quotes"][0]["text"] == "I'll send you the deck tonight."
    start = datetime.fromisoformat(detail["conversations"][0]["started_at"]).timestamp()
    assert detail["quotes"][0]["ts"] == pytest.approx(start + 300.0)
    topic = client.get("/graph/node/topic:roadmap").json()
    assert all("roadmap" in q["text"].lower() for q in topic["quotes"]) and topic["quotes"]
    habit = client.get("/graph/node/habit:interrupt").json()
    assert all(q["speaker"] == "me" for q in habit["quotes"]) and habit["quotes"]
    me = client.get("/graph/node/me").json()
    assert len(me["conversations"]) == 4


def test_node_detail_unknown_is_404(client: TestClient) -> None:
    assert client.get("/graph/node/person:nobody").status_code == 404
    assert client.get("/graph/node/conversation:s4").status_code == 404  # outside the 30-day window
    assert client.get("/graph/node/conversation:s4?days=60").status_code == 200


def test_get_graph_lazily_fills_missing_topics(db: DB, client: TestClient) -> None:
    _write(db, "s6", 0.5, None, None, wearer=("The budget review. The budget review again.",))
    assert "s6" not in load_topics(db)
    graph = KnowledgeGraph.model_validate(client.get("/graph").json())
    assert "topic:budget-review" in _by_id(graph)  # keyword fallback inline, no LLM call
    assert load_topics(db)["s6"] == ("budget review",)  # cached by the background refresh


def test_post_refresh(db: DB, client: TestClient) -> None:
    _write(db, "s7", 0.5, None, None)
    body = client.post("/graph/refresh").json()
    assert body["refreshed"] == 1 and body["remaining"] == 0
    again = client.post("/graph/refresh").json()
    assert again["refreshed"] == 0 and again["remaining"] == 0
    assert again["labels_consolidated"] == 0 and again["commitments_closed"] == 0  # no LLM in tests


def test_build_is_pure(db: DB) -> None:
    from backend.graph._load import load_input

    inp = load_input(db, 30, NOW.timestamp())
    first = build_graph(inp, 1.0)
    again = build_graph(replace(inp), 1.0)
    assert first == again and first.generated_at == 1.0


def test_person_nodes_carry_the_relationship(db: DB, client: TestClient) -> None:
    from backend.relationships import set_user_kind

    set_user_kind(db, "alex", "boss")
    nodes = _by_id(KnowledgeGraph.model_validate(client.get("/graph").json()))
    alex, priya = nodes["person:alex"].meta, nodes["person:priya"].meta  # type: ignore[attr-defined]
    assert (alex["relationship"], alex["relationship_confidence"], alex["relationship_source"]) == ("boss", 1.0, "user")
    assert (priya["relationship"], priya["relationship_confidence"], priya["relationship_source"]) == (None, None, None)
