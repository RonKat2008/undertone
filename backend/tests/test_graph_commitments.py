"""Commitments: manual done/reopen, automatic closing from later conversations (stubbed LLM), due days."""

from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.bus import Bus
from backend.contracts import BookmarkEvent, CommitmentStatus, DebriefNumbers, KnowledgeGraph, Person
from backend.db import DB
from backend.graph import _closing, router
from backend.graph._closing import PromiseCheck, check_commitments, is_supported
from backend.graph._commitments import get_state, pending_checks, set_manual
from backend.graph._due import due_day
from backend.growth._writer import SessionSpec, write_session
from backend.llm import LLMUnavailable
from backend.state import AppState
from backend.studio.default import default_coach

NUMBERS = DebriefNumbers(talk_ratio=0.5, interruptions=1, questions=2, fillers_per_min=1.0, wpm=150)
NOW = datetime.now(timezone.utc)
DONE_LINE = "By the way, I sent you the deck yesterday morning."


def _write(db: DB, sid: str, days_ago: float, person: str | None, wearer: tuple[str, ...]) -> None:
    write_session(db, SessionSpec(session_id=sid, started_at=NOW - timedelta(days=days_ago), numbers=NUMBERS,
                                  person_id=person, wearer_texts=wearer, other_texts=("Okay.",)))


def _bookmark_id(db: DB, sid: str) -> int:
    return int(db.query("SELECT id FROM bookmarks WHERE session_id = ? AND source = 'promise'", (sid,))[0]["id"])


@pytest.fixture
def db(tmp_path: Path) -> DB:
    database = DB(tmp_path / "c.db")
    database.save_person(Person(person_id="alex", name="Alex"))
    _write(database, "p1", 5, "alex", ("I'll send you the deck by Friday.",))
    database.save_bookmark("p1", BookmarkEvent(source="promise", text="I'll send you the deck by Friday.", ts=10.0))
    _write(database, "later_other", 4, "priya", (DONE_LINE,))  # a different person: never checked
    _write(database, "later1", 3, "alex", ("The roadmap is fine.",))
    _write(database, "later2", 2, "alex", (DONE_LINE,))
    _write(database, "loose", 2, None, ("I'll call the plumber.",))
    database.save_bookmark("loose", BookmarkEvent(source="promise", text="I'll call the plumber.", ts=5.0))
    return database


def _client(db: DB) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.state.app = AppState(bus=Bus(), db=db, active_coach=default_coach())
    return TestClient(app)


def _stub(monkeypatch: pytest.MonkeyPatch, answer: PromiseCheck | None) -> list[str]:
    calls: list[str] = []

    async def fake(prompt: str, schema: type, **kwargs: object) -> PromiseCheck:
        calls.append(prompt)
        if answer is None:
            raise LLMUnavailable("tests")
        return answer if DONE_LINE in prompt else PromiseCheck(done=False, quote="")

    monkeypatch.setattr(_closing, "generate_structured", fake)
    return calls


def test_pending_pairs_only_later_conversations_with_the_same_person(db: DB) -> None:
    bid = _bookmark_id(db, "p1")
    assert pending_checks(db, 10) == [(bid, "later1"), (bid, "later2")]


def test_auto_close_with_a_real_quote_and_cached_checks(db: DB, monkeypatch: pytest.MonkeyPatch) -> None:
    calls = _stub(monkeypatch, PromiseCheck(done=True, quote="I sent you the deck yesterday morning."))
    assert asyncio.run(check_commitments(db)) == 1
    assert len(calls) == 2
    assert "Alex" not in calls[0] and "I'll send you the deck by Friday." in calls[0]
    state = get_state(db, _bookmark_id(db, "p1"))
    assert state.open is False and state.closed_by == "auto" and state.closed_session_id == "later2"
    assert state.evidence == "I sent you the deck yesterday morning."
    assert asyncio.run(check_commitments(db)) == 0 and len(calls) == 2  # cached, closed: no new calls
    graph = KnowledgeGraph.model_validate(_client(db).get("/graph").json())
    node = next(n for n in graph.nodes if n.id == f"commitment:{_bookmark_id(db, 'p1')}")
    assert node.meta["open"] is False and node.meta["closed_by"] == "auto"
    assert graph.stats.open_commitments == 1  # the plumber promise is still open


@pytest.mark.parametrize("answer", [
    PromiseCheck(done=True, quote="I emailed the whole deck to Alex."),  # not in the wearer's words
    PromiseCheck(done=True, quote="sent"),  # too short to be evidence
    PromiseCheck(done=False, quote="I sent you the deck yesterday morning."),
])
def test_conservative_no_close_without_supported_evidence(db: DB, monkeypatch: pytest.MonkeyPatch,
                                                          answer: PromiseCheck) -> None:
    _stub(monkeypatch, answer)
    assert asyncio.run(check_commitments(db)) == 0
    assert get_state(db, _bookmark_id(db, "p1")).open is True
    assert pending_checks(db, 10) == []  # each pair was checked once and cached


def test_no_llm_means_no_closing_and_nothing_cached(db: DB, monkeypatch: pytest.MonkeyPatch) -> None:
    _stub(monkeypatch, None)
    assert asyncio.run(check_commitments(db)) == 0
    assert len(pending_checks(db, 10)) == 2


def test_manual_state_wins_over_the_automatic_check(db: DB, monkeypatch: pytest.MonkeyPatch) -> None:
    bid = _bookmark_id(db, "p1")
    set_manual(db, bid, True)  # explicitly reopened by hand
    calls = _stub(monkeypatch, PromiseCheck(done=True, quote="I sent you the deck yesterday morning."))
    assert asyncio.run(check_commitments(db)) == 0 and calls == []
    assert get_state(db, bid).open is True and get_state(db, bid).manual is True


def test_post_commitment_done_and_reopen(db: DB) -> None:
    client = _client(db)
    bid = _bookmark_id(db, "loose")
    done = CommitmentStatus.model_validate(client.post(f"/graph/commitment/commitment:{bid}",
                                                       json={"open": False}).json())
    assert done.open is False and done.closed_by == "manual" and done.closed_at is not None
    assert done.id == f"commitment:{bid}" and done.bookmark_id == bid
    reopened = client.post(f"/graph/commitment/{bid}", json={"open": True}).json()
    assert reopened["open"] is True and reopened["closed_by"] is None
    assert client.post("/graph/commitment/999", json={"open": False}).status_code == 404
    assert client.post("/graph/commitment/commitment:abc", json={"open": False}).status_code == 404
    assert client.post(f"/graph/commitment/{bid}", json={}).status_code == 422
    db.save_bookmark("loose", BookmarkEvent(source="phone", text=None, ts=1.0))
    phone = int(db.query("SELECT id FROM bookmarks WHERE source = 'phone'")[0]["id"])
    assert client.post(f"/graph/commitment/{phone}", json={"open": False}).status_code == 404


def _ts(day: date) -> float:
    return datetime(day.year, day.month, day.day, 12, tzinfo=timezone.utc).timestamp()


WED = date(2026, 11, 11)  # a Wednesday


@pytest.mark.parametrize(("text", "expected"), [
    ("I'll send you the deck by Friday.", date(2026, 11, 13)),
    ("I'll do it on Monday", date(2026, 11, 16)),
    ("I'll send it tonight", WED),
    ("I'll call you tomorrow", date(2026, 11, 12)),
    ("by end of day", WED),
    ("I'll send it next Friday", None),  # ambiguous
    ("by Wednesday", None),  # said on a Wednesday: ambiguous
    ("I'll send it soon", None),
    ("tonight or tomorrow", None),  # two deadlines
    ("", None),
])
def test_due_day_parsing(text: str, expected: date | None) -> None:
    assert due_day(text, _ts(WED)) == expected


def test_is_supported_normalises_punctuation() -> None:
    check = PromiseCheck(done=True, quote="I sent you the deck, yesterday morning!")
    assert is_supported(check, DONE_LINE)
