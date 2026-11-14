"""Relationship memory: blending, user override, kept-session filters, refresh, table creation."""

from __future__ import annotations

import asyncio
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest

from backend.contracts import ChoiceAnswer, DebriefNumbers, NoulAnswer, Person, Relationship
from backend.db import DB
from backend.growth._writer import SessionSpec, write_session
from backend.relationships import (
    clear_user_kind, refresh_person, refresh_stale, relationship_for, relationships_by_person, set_user_kind,
)
from backend.relationships import examples as ex
from backend.relationships._blend import FLIP_AFTER, Memory, blend
from backend.relationships._sample import kept_session_ids, load_sample
from backend.relationships._store import TABLE, load_row

NOW = datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc)
NUMBERS = DebriefNumbers(talk_ratio=0.5, interruptions=0, questions=2, fillers_per_min=1.0, wpm=150)


def rel(kind: str, conf: float = 0.8, source: str = "decisions", sessions: int = 1, **kw: Any) -> Relationship:
    return Relationship(person_id="p", kind=kind, confidence=conf, source=source,  # type: ignore[arg-type]
                        based_on_sessions=sessions, updated_at=1.0, evidence=["x"], **kw)


# ---------- blending (pure) ----------
def test_first_result_is_adopted() -> None:
    m = blend(Memory(), rel("boss"), has_new=True)
    assert m.inferred is not None and m.inferred.kind == "boss" and m.pending_kind is None


def test_agreement_raises_confidence() -> None:
    m = blend(Memory(inferred=rel("friend", 0.6)), rel("friend", 0.7, sessions=2), has_new=True)
    assert m.inferred.kind == "friend" and m.inferred.confidence > 0.6
    assert m.inferred.based_on_sessions == 2


def test_one_odd_conversation_does_not_flip() -> None:
    old = Memory(inferred=rel("friend", 0.8, sessions=3))
    m = blend(old, rel("coworker", 0.9, sessions=4), has_new=True)
    assert m.inferred.kind == "friend" and m.inferred.confidence < 0.8
    assert (m.pending_kind, m.pending_count) == ("coworker", 1)


def test_repeated_disagreement_flips() -> None:
    m = Memory(inferred=rel("friend", 0.8, sessions=3))
    for i in range(FLIP_AFTER):
        m = blend(m, rel("coworker", 0.9, sessions=4 + i), has_new=True)
    assert m.inferred.kind == "coworker" and m.pending_kind is None


def test_disagreement_without_new_sessions_changes_nothing() -> None:
    old = Memory(inferred=rel("friend", 0.8, sessions=3))
    for _ in range(3):
        m = blend(old, rel("coworker", 0.9, sessions=3), has_new=False)
        assert m.inferred.kind == "friend" and m.pending_count == 0


def test_different_challengers_reset_the_count() -> None:
    m = Memory(inferred=rel("friend", 0.8, sessions=3))
    m = blend(m, rel("coworker", 0.9), has_new=True)
    m = blend(m, rel("boss", 0.9), has_new=True)
    assert m.inferred.kind == "friend" and (m.pending_kind, m.pending_count) == ("boss", 1)


def test_unknown_never_replaces_a_label() -> None:
    old = Memory(inferred=rel("friend", 0.8))
    m = blend(old, rel("unknown", 0.0, source="rules", sessions=2), has_new=True)
    assert m.inferred.kind == "friend" and m.inferred.based_on_sessions == 2


def test_rules_never_overturn_decisions_but_decisions_overturn_rules() -> None:
    m = blend(Memory(inferred=rel("friend", 0.8)), rel("boss", 0.4, source="rules"), has_new=True)
    assert m.inferred.kind == "friend" and m.inferred.source == "decisions" and m.pending_count == 0
    m = blend(Memory(inferred=rel("friend", 0.4, source="rules")), rel("boss", 0.8), has_new=True)
    assert m.inferred.kind == "boss" and m.inferred.source == "decisions"


# ---------- database helpers ----------
def _session(db: DB, sid: str, pid: str | None, lines: ex.Lines, days_ago: int = 0) -> None:
    write_session(db, SessionSpec(
        session_id=sid, started_at=NOW - timedelta(days=days_ago), numbers=NUMBERS, person_id=pid,
        wearer_texts=tuple(t for s, t in lines if s == "me"),
        other_texts=tuple(t for s, t in lines if s == "other")))


@pytest.fixture
def db(tmp_path: Path):
    d = DB(tmp_path / "rel.db")
    d.save_person(Person(person_id="alex", name="Alex"))
    yield d
    d.close()


def stub(result: dict[str, Any] | Exception, delay: float = 0.0):
    calls: list[str] = []

    async def decide(text: str, questions: dict, *, timeout_s: float) -> dict[str, Any]:
        calls.append(text)
        if delay:
            await asyncio.sleep(delay)
        if isinstance(result, Exception):
            raise result
        return result

    return decide, calls


def c(v: str) -> ChoiceAnswer:
    return ChoiceAnswer(choice=v, probabilities={v: 0.9}, confidence=0.9)


BOSS_ANSWERS = {"topics": c("work"), "who_directs": c("they_lead"), "permission": c("i_ask"),
                "familiarity": c("acquainted"), "formality": c("neutral"), "same_org": NoulAnswer(p=0.9, confidence=0.9)}
FRIEND_ANSWERS = {"topics": c("personal"), "familiarity": c("close"), "formality": c("casual"),
                  "joking": NoulAnswer(p=0.9, confidence=0.9)}


def test_kept_filter_skips_discarded_and_sensitive(db: DB) -> None:
    _session(db, "s1", "alex", ex.BOSS, 3)
    _session(db, "s2", "alex", ex.FRIEND, 2)
    _session(db, "s3", "alex", ex.PARENT, 1)
    _session(db, "s4", "alex", ex.PARTNER, 0)
    db.set_verdict("s2", False, "sensitive", "decisions")
    db.set_verdict("s3", False, "noise", "decisions")
    db.set_verdict("s4", True, "keep", "decisions")
    assert kept_session_ids(db, "alex") == ["s4", "s1"]  # newest first
    text = " ".join(t.text for conv in load_sample(db, "alex").conversations for t in conv)
    assert "climbing" not in text and "grandma" not in text  # sensitive and noise never sampled


def test_unfinished_sessions_are_skipped(db: DB) -> None:
    db.create_session("open", "listener", "Listener", "regular", NOW.isoformat())
    db.set_session_person("open", "alex")
    assert kept_session_ids(db, "alex") == []


def test_sample_is_bounded(db: DB) -> None:
    for i in range(12):
        _session(db, f"s{i}", "alex", ex.BOSS, i)
    s = load_sample(db, "alex")
    assert sum(len(cv) for cv in s.conversations) <= 80 and len(s.conversations) <= 5
    assert len(s.session_ids) == 12


async def test_refresh_infers_and_stores(db: DB) -> None:
    _session(db, "s1", "alex", ex.BOSS)
    decide, calls = stub(BOSS_ANSWERS)
    r = await refresh_person(db, "alex", decide=decide)
    assert r is not None and r.kind == "boss" and r.based_on_sessions == 1 and len(calls) == 1
    assert relationship_for(db, "alex") == r
    assert relationships_by_person(db) == {"alex": r}


async def test_refresh_is_incremental(db: DB) -> None:
    _session(db, "s1", "alex", ex.BOSS)
    decide, calls = stub(BOSS_ANSWERS)
    await refresh_person(db, "alex", decide=decide)
    await refresh_person(db, "alex", decide=decide)  # nothing new: no call
    assert len(calls) == 1
    _session(db, "s2", "alex", ex.BOSS, days_ago=-1)
    r = await refresh_person(db, "alex", decide=decide)
    assert len(calls) == 2 and r.based_on_sessions == 2
    await refresh_person(db, "alex", decide=decide, force=True)
    assert len(calls) == 3


async def test_discarding_a_seen_session_starts_over(db: DB) -> None:
    _session(db, "s1", "alex", ex.BOSS, 1)
    _session(db, "s2", "alex", ex.FRIEND, 0)
    decide, _ = stub(BOSS_ANSWERS)
    await refresh_person(db, "alex", decide=decide)
    db.set_verdict("s1", False, "sensitive", "user")
    decide2, calls = stub(FRIEND_ANSWERS)
    r = await refresh_person(db, "alex", decide=decide2)
    assert len(calls) == 1 and r.kind == "friend" and r.based_on_sessions == 1


async def test_one_refresh_per_person_at_a_time(db: DB) -> None:
    _session(db, "s1", "alex", ex.BOSS)
    decide, calls = stub(BOSS_ANSWERS, delay=0.05)
    results = await asyncio.gather(*(refresh_person(db, "alex", decide=decide, force=True) for _ in range(4)))
    assert len(calls) == 1
    # callers that arrived mid-refresh wait for it and share its result (not "nothing yet")
    assert all(r is not None and r.kind == "boss" for r in results)


async def test_refresh_never_raises(db: DB, monkeypatch: pytest.MonkeyPatch) -> None:
    _session(db, "s1", "alex", ex.BOSS)
    from backend.relationships import _refresh

    def boom(*_: Any, **__: Any) -> Any:
        raise sqlite3.OperationalError("disk gone")

    monkeypatch.setattr(_refresh, "load_sample", boom)
    assert await refresh_person(db, "alex", decide=stub(BOSS_ANSWERS)[0]) is None
    assert await refresh_stale(db, decide=stub(BOSS_ANSWERS)[0]) == 0


async def test_no_key_uses_rules(db: DB) -> None:
    _session(db, "s1", "alex", ex.FRIEND)
    r = await refresh_person(db, "alex")  # tests run with no Gemini key
    assert r is not None and r.source == "rules" and r.kind == "friend"


async def test_user_label_is_never_overwritten(db: DB) -> None:
    _session(db, "s1", "alex", ex.BOSS)
    set_user_kind(db, "alex", "friend")
    decide, calls = stub(BOSS_ANSWERS)
    r = await refresh_person(db, "alex", decide=decide, force=True)
    assert r.kind == "friend" and r.source == "user" and r.confidence == 1 and calls == []
    _session(db, "s2", "alex", ex.BOSS, -1)
    await refresh_stale(db, decide=decide)
    assert relationship_for(db, "alex").source == "user"
    clear_user_kind(db, "alex")
    r = await refresh_person(db, "alex", decide=decide)
    assert r.kind == "boss" and r.source == "decisions"


async def test_refresh_stale_only_touches_changed_people(db: DB) -> None:
    db.save_person(Person(person_id="priya", name="Priya"))
    _session(db, "s1", "alex", ex.BOSS)
    _session(db, "s2", "priya", ex.FRIEND)
    decide, calls = stub(BOSS_ANSWERS)
    assert await refresh_stale(db, decide=decide) == 2
    assert await refresh_stale(db, decide=decide) == 0
    assert len(calls) == 2


def test_table_is_created_on_an_existing_database(tmp_path: Path) -> None:
    path = tmp_path / "old.db"
    old = DB(path)
    _session(old, "s1", "alex", ex.BOSS)
    old.close()
    fresh = DB(path)
    assert relationship_for(fresh, "alex") is None
    assert fresh.query("SELECT name FROM sqlite_master WHERE name = ?", (TABLE,))
    assert load_row(fresh, "alex") is None
    fresh.close()
