"""Topic near-duplicate merging: rules, stable incremental assignment, LLM consolidation (stubbed)."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from backend.db import DB
from backend.graph import _aliases
from backend.graph._aliases import TopicGroups, consolidate_topics, load_aliases, topic_map
from backend.graph._cache import save_topics
from backend.graph._merge import assign, is_weak, same_topic
from backend.graph._topics import clean_label, keyword_topics, merge_labels
from backend.llm import LLMUnavailable

LIVE_PAIRS = [
    ("coffee place", "coffee shop"),
    ("roadmap", "product roadmap"),
    ("heating issue", "broken heating"),
    ("reading", "reading habits"),
]


@pytest.mark.parametrize(("a", "b"), LIVE_PAIRS)
def test_live_pairs_are_the_same_topic(a: str, b: str) -> None:
    assert same_topic(a, b) and same_topic(b, a)


@pytest.mark.parametrize(("a", "b"), [
    ("product roadmap", "product launch"), ("work", "work stress"), ("coffee", "tea"),
    ("lisbon trip", "paris trip"), ("hiring", "firing"), ("climbing", "climbing gym membership cost"),
])
def test_distinct_topics_stay_apart(a: str, b: str) -> None:
    assert not same_topic(a, b)


def test_plurals_merge() -> None:
    assert same_topic("stories", "story") and same_topic("product roadmaps", "product roadmap")
    assert same_topic("lunch", "lunches")


@pytest.mark.parametrize("weak", ["place", "issue", "things", "the stuff", "plans"])
def test_generic_nouns_alone_are_weak_and_dropped(weak: str) -> None:
    assert is_weak(weak) and clean_label(weak) == ""


def test_keyword_fallback_skips_generic_place() -> None:
    text = "the place was nice. that place again. the coffee place had coffee. coffee coffee."
    topics = keyword_topics(text)
    assert "place" not in topics and "coffee" in topics


def test_assign_maps_each_pair_onto_one_canonical_first_seen_wins() -> None:
    labels = ["coffee place", "roadmap", "heating issue", "reading", "coffee shop", "product roadmap",
              "broken heating", "reading habits", "hiring"]
    mapping = assign(labels, {})
    assert mapping["coffee shop"] == "coffee place"
    assert mapping["product roadmap"] == "roadmap"
    assert mapping["broken heating"] == "heating issue"
    assert mapping["reading habits"] == "reading"
    assert mapping["hiring"] == "hiring"


def test_assign_is_incremental_and_never_moves_a_canonical() -> None:
    first = assign(["roadmap", "hiring"], {})
    later = assign(["product roadmap", "q1 hiring plan"], first)
    assert later["product roadmap"] == "roadmap"
    assert first == {"roadmap": "roadmap", "hiring": "hiring"}  # untouched
    # A bridge label that could match two canonicals joins one of them; neither canonical moves.
    bridged = assign(["roadmap hiring"], first)
    assert bridged["roadmap hiring"] in {"roadmap", "hiring"}
    assert bridged["roadmap"] == "roadmap" and bridged["hiring"] == "hiring"


def test_merge_labels_uses_the_new_rules() -> None:
    assert merge_labels(["Broken heating", "reading habits"], ["heating issue", "reading"]) == (
        "heating issue", "reading")


# ---------- persisted aliases + LLM consolidation ----------
def _db(tmp_path: Path) -> DB:
    db = DB(tmp_path / "t.db")
    save_topics(db, "s1", ("coffee place", "roadmap"), "llm")
    save_topics(db, "s2", ("coffee shop", "product roadmap", "q1 planning"), "llm")
    save_topics(db, "s3", ("quarter planning", "reading"), "llm")
    return db


def test_topic_map_without_llm_is_rule_based_and_writes_nothing(tmp_path: Path) -> None:
    db = _db(tmp_path)
    m = topic_map(db)
    assert m["coffee shop"] == "coffee place" and m["product roadmap"] == "roadmap"
    assert m["quarter planning"] == "quarter planning"
    assert load_aliases(db) == {}
    assert topic_map(db) == m  # deterministic
    db.close()


def test_consolidation_without_llm_persists_nothing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db = _db(tmp_path)

    async def down(prompt: str, schema: type, **kwargs: object) -> object:
        raise LLMUnavailable("tests")

    monkeypatch.setattr(_aliases, "generate_structured", down)
    assert asyncio.run(consolidate_topics(db)) == 0
    assert load_aliases(db) == {}
    db.close()


def test_llm_consolidation_is_cached_and_conservative(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db = _db(tmp_path)
    calls: list[str] = []

    async def fake(prompt: str, schema: type, **kwargs: object) -> TopicGroups:
        calls.append(prompt)
        assert schema is TopicGroups
        return TopicGroups.model_validate({"groups": [
            {"labels": ["q1 planning", "quarter planning"]},
            {"labels": ["reading", "invented label"]},  # unknown labels are ignored
        ]})

    monkeypatch.setattr(_aliases, "generate_structured", fake)
    assert asyncio.run(consolidate_topics(db)) == 7
    aliases = load_aliases(db)
    assert aliases["quarter planning"] == "q1 planning" and aliases["coffee shop"] == "coffee place"
    assert "invented label" not in aliases
    assert asyncio.run(consolidate_topics(db)) == 0 and len(calls) == 1  # cached: no second call
    # New labels later map onto persisted canonicals; persisted canonicals never move.
    save_topics(db, "s4", ("coffee places", "roadmaps"), "llm")

    async def merge_canonicals(prompt: str, schema: type, **kwargs: object) -> TopicGroups:
        return TopicGroups.model_validate({"groups": [{"labels": ["coffee place", "roadmap", "coffee places"]}]})

    monkeypatch.setattr(_aliases, "generate_structured", merge_canonicals)
    asyncio.run(consolidate_topics(db))
    after = load_aliases(db)
    assert after["roadmap"] == "roadmap" and after["coffee place"] == "coffee place"
    assert after["coffee places"] == "coffee place" and after["roadmaps"] == "roadmap"
    db.close()
