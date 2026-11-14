"""People cards: the wearer's own behaviour with a person against the wearer's own average."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from backend.contracts import BookmarkReview, Debrief, DebriefNumbers, Person
from backend.db import DB
from backend.growth._people import people_for, person_cards, slugify, tag_session
from backend.growth._store import load_sessions
from backend.growth._writer import SessionSpec, write_session

START = datetime(2026, 11, 1, 10, tzinfo=timezone.utc)


def nums(talk: float = 0.5, inter: int = 0, q: int = 2, fill: float = 4.0, wpm: float = 150) -> DebriefNumbers:
    return DebriefNumbers(talk_ratio=talk, interruptions=inter, questions=q, fillers_per_min=fill, wpm=wpm)


def add(db: DB, sid: str, day: int, n: DebriefNumbers, person: str | None = None,
        notes: tuple[str, ...] = (), if_then: str = "When you finish a point, ask a question.") -> None:
    write_session(db, SessionSpec(session_id=sid, started_at=START + timedelta(days=day), numbers=n,
                                  person_id=person, notes=notes, if_then=if_then))


@pytest.fixture
def db(tmp_path: Path) -> DB:
    return DB(tmp_path / "t.db")


def card(cards: list[Person], pid: str) -> Person:
    return next(c for c in cards if c.person_id == pid)


def test_slugify() -> None:
    assert slugify("Alex Chen") == "alex-chen"
    assert slugify("  Priya!! ") == "priya"
    assert slugify("") == "person"
    assert slugify("???") == "person"


def test_interrupt_pattern_says_3x(db: DB) -> None:
    for i in range(4):
        add(db, f"o{i}", i, nums(inter=0))
    add(db, "a1", 5, nums(inter=6), "alex")
    add(db, "a2", 6, nums(inter=6), "alex")
    cards = person_cards(load_sessions(db), [Person(person_id="alex", name="Alex Chen")])
    alex = card(cards, "alex")
    assert alex.sessions == 2
    assert alex.pattern == "You interrupt Alex 3x more than you usually do."


def test_talk_share_pattern(db: DB) -> None:
    for i in range(3):
        add(db, f"o{i}", i, nums(talk=0.46))
    add(db, "s1", 4, nums(talk=0.7), "sam")
    sam = card(person_cards(load_sessions(db), [Person(person_id="sam", name="Sam")]), "sam")
    assert sam.pattern == "You talk 70% of the time with Sam, against 52% usually."


def test_questions_pattern_twice(db: DB) -> None:
    for i in range(2):
        add(db, f"o{i}", i, nums(q=1))
    add(db, "p1", 3, nums(q=4), "priya")
    priya = card(person_cards(load_sessions(db), [Person(person_id="priya", name="Priya")]), "priya")
    assert priya.pattern == "You ask Priya twice as many questions as usual."


def test_one_session_overall_and_matching_numbers(db: DB) -> None:
    add(db, "a1", 0, nums(talk=0.62), "alex")
    alex = card(person_cards(load_sessions(db), [Person(person_id="alex", name="Alex")]), "alex")
    assert alex.pattern == "One conversation so far; you talked 62% of the time."
    add(db, "o1", 1, nums(talk=0.62))
    alex = card(person_cards(load_sessions(db), [Person(person_id="alex", name="Alex")]), "alex")
    assert alex.pattern == "With Alex your numbers match your usual."


def test_brief_prefers_follow_up_note_then_if_then(db: DB) -> None:
    add(db, "a1", 0, nums(talk=0.5), "alex", notes=("Ask about his trip.",))
    add(db, "a2", 1, nums(talk=0.7), "alex", notes=("Ask about his trip to Lisbon.", "Warm start."))
    alex = card(person_cards(load_sessions(db), [Person(person_id="alex", name="Alex")]), "alex")
    assert alex.brief == "Last time you talked 70%. Ask about his trip to Lisbon."
    add(db, "a3", 2, nums(talk=0.6), "alex", notes=("The room was loud.",),
        if_then="When they pause, count to two.")
    alex = card(person_cards(load_sessions(db), [Person(person_id="alex", name="Alex")]), "alex")
    assert alex.brief == "Last time you talked 60%. When they pause, count to two."
    assert len(alex.brief) <= 140


def test_brief_prefers_bookmark_follow_up(db: DB) -> None:
    add(db, "a1", 0, nums(talk=0.5), "alex", notes=("Ask about the launch.",))
    stored = db.load_debrief("a1")
    assert stored is not None
    bm = BookmarkReview(ts=12.0, source="promise", snippet="I'll send it", what_happened="You promised a doc.",
                        follow_up="Send Alex the doc you promised.")
    debrief: Debrief = stored[0].model_copy(update={"bookmarks": [bm]})
    db.save_debrief("a1", debrief, None)
    alex = card(person_cards(load_sessions(db), [Person(person_id="alex", name="Alex")]), "alex")
    assert alex.brief == "Last time you talked 50%. Send Alex the doc you promised."


def test_person_without_sessions_and_sort_order(db: DB) -> None:
    add(db, "a1", 0, nums(), "alex")
    add(db, "s1", 3, nums(), "sam")
    people = [Person(person_id="alex", name="Alex"), Person(person_id="zoe", name="Zoe"),
              Person(person_id="sam", name="Sam")]
    cards = person_cards(load_sessions(db), people)
    assert [c.person_id for c in cards] == ["sam", "alex", "zoe"]
    zoe = card(cards, "zoe")
    assert (zoe.sessions, zoe.pattern, zoe.brief) == (0, "", "")


def test_patterns_never_mention_other_people(db: DB) -> None:
    for i in range(3):
        add(db, f"o{i}", i, nums(inter=1), "sam")
    add(db, "a1", 5, nums(inter=4), "alex")
    cards = person_cards(load_sessions(db), [Person(person_id="alex", name="Alex"),
                                             Person(person_id="sam", name="Sam")])
    assert "Sam" not in card(cards, "alex").pattern
    assert all("anyone" not in c.pattern for c in cards)


def test_tag_session_creates_person(db: DB) -> None:
    add(db, "s1", 0, nums(talk=0.7))
    p = tag_session(db, "s1", "Alex Chen")
    assert (p.person_id, p.name, p.sessions) == ("alex-chen", "Alex Chen", 1)
    assert p.brief.startswith("Last time you talked 70%.")
    assert db.get_session("s1")["person_id"] == "alex-chen"  # type: ignore[index]
    assert [x.person_id for x in db.list_people()] == ["alex-chen"]


def test_tag_session_existing_keeps_stored_name_and_retag_is_idempotent(db: DB) -> None:
    add(db, "s1", 0, nums())
    add(db, "s2", 1, nums())
    tag_session(db, "s1", "Alex Chen")
    p = tag_session(db, "s2", "alex chen", person_id="alex-chen")
    assert (p.name, p.sessions) == ("Alex Chen", 2)
    p = tag_session(db, "s2", "Alex Chen")
    assert p.sessions == 2
    assert card(people_for(db), "alex-chen").sessions == 2


def test_tag_session_move_updates_both(db: DB) -> None:
    add(db, "s1", 0, nums())
    add(db, "s2", 1, nums())
    tag_session(db, "s1", "Alex")
    tag_session(db, "s2", "Alex")
    sam = tag_session(db, "s2", "Sam")
    assert sam.sessions == 1
    stored = {p.person_id: p.sessions for p in db.list_people()}
    assert stored == {"alex": 1, "sam": 1}


def test_tag_session_errors(db: DB) -> None:
    add(db, "s1", 0, nums())
    with pytest.raises(LookupError):
        tag_session(db, "nope", "Alex")
    with pytest.raises(ValueError):
        tag_session(db, "s1", "   ")
    with pytest.raises(ValueError):
        tag_session(db, "s1", "x" * 81)
