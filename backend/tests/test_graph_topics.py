"""Topic extraction: keyword fallback, LLM path (stubbed), label merging, per-session cache."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from backend.contracts import DebriefNumbers
from backend.db import DB
from backend.graph import _refresh, _topics
from backend.graph._cache import load_topics, missing_sessions, save_topics
from backend.graph._topics import (
    TopicList,
    clean_label,
    extract_topics,
    keyword_topics,
    merge_labels,
    slugify,
)
from backend.growth._writer import SessionSpec, write_session
from backend.llm import LLMUnavailable

NUMBERS = DebriefNumbers(talk_ratio=0.5, interruptions=1, questions=2, fillers_per_min=1.0, wpm=150)
TRANSCRIPT = (
    "me: Um, the product roadmap slipped because the vendor API changed again.\n"
    "other: The product roadmap needs a new date. Is the vendor API stable now?\n"
    "me: I think the vendor API is fine, but hiring is slow. Hiring takes months.\n"
    "other: Like, you know, hiring is hard."
)


def test_keyword_fallback_finds_recurring_phrases_and_words() -> None:
    topics = keyword_topics(TRANSCRIPT)
    assert topics[:2] == ("vendor api", "product roadmap")
    assert "hiring" in topics
    assert len(topics) <= 5
    assert all(t == t.lower() for t in topics)


def test_keyword_fallback_drops_fillers_and_stopwords() -> None:
    topics = keyword_topics("um um like like you know you know basically basically the the and and")
    assert topics == ()


def test_keyword_fallback_is_deterministic_and_capped() -> None:
    text = " ".join(f"{w} {w}." for w in ("alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"))
    assert keyword_topics(text) == keyword_topics(text)
    assert keyword_topics(text) == ("alpha", "bravo", "charlie", "delta", "echo")


def test_clean_label_and_slug() -> None:
    assert clean_label("  The Product Roadmap!! ") == "the product roadmap"
    assert clean_label("um") == ""
    assert clean_label("one two three four five six") == "one two three four"
    assert slugify("Vendor API / pricing") == "vendor-api-pricing"


def test_merge_reuses_existing_near_duplicates() -> None:
    merged = merge_labels(["Product roadmaps", "hiring", "Hiring", "lisbon trip"], ["product roadmap"])
    assert merged == ("product roadmap", "hiring", "lisbon trip")


def test_llm_path_merges_against_existing(monkeypatch: pytest.MonkeyPatch) -> None:
    prompts: list[str] = []

    async def fake(prompt: str, schema: type, **kwargs: object) -> TopicList:
        prompts.append(prompt)
        assert schema is TopicList
        return TopicList(topics=["Product Roadmaps", "Q1 hiring", "um"])

    monkeypatch.setattr(_topics, "generate_structured", fake)
    labels, source = asyncio.run(extract_topics(TRANSCRIPT, ["product roadmap"]))
    assert (labels, source) == (("product roadmap", "q1 hiring"), "llm")
    assert len(prompts) == 1 and TRANSCRIPT in prompts[0]


def test_llm_failure_falls_back_to_keywords(monkeypatch: pytest.MonkeyPatch) -> None:
    async def broken(prompt: str, schema: type, **kwargs: object) -> TopicList:
        raise LLMUnavailable("no key")

    monkeypatch.setattr(_topics, "generate_structured", broken)
    labels, source = asyncio.run(extract_topics(TRANSCRIPT, []))
    assert source == "keywords" and labels == keyword_topics(TRANSCRIPT)


def test_llm_empty_answer_falls_back_to_keywords(monkeypatch: pytest.MonkeyPatch) -> None:
    async def empty(prompt: str, schema: type, **kwargs: object) -> TopicList:
        return TopicList(topics=["um", ""])

    monkeypatch.setattr(_topics, "generate_structured", empty)
    assert asyncio.run(extract_topics(TRANSCRIPT, []))[1] == "keywords"


def _write(db: DB, sid: str, days_ago: int, wearer: tuple[str, ...]) -> None:
    start = datetime.now(timezone.utc) - timedelta(days=days_ago)
    write_session(db, SessionSpec(session_id=sid, started_at=start, numbers=NUMBERS, wearer_texts=wearer))


def test_cache_hit_means_no_second_llm_call(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db = DB(tmp_path / "t.db")
    _write(db, "s1", 1, ("the product roadmap slipped", "the product roadmap again"))
    _write(db, "s2", 2, ("hiring is slow", "hiring again"))
    calls: list[str] = []

    async def fake(prompt: str, schema: type, **kwargs: object) -> TopicList:
        calls.append(prompt)
        return TopicList(topics=["roadmap"] if "slipped" in prompt else ["hiring"])

    monkeypatch.setattr(_topics, "generate_structured", fake)
    assert asyncio.run(_refresh.refresh_topics(db)) == 2
    assert asyncio.run(_refresh.refresh_topics(db)) == 0
    assert len(calls) == 2
    assert load_topics(db) == {"s1": ("roadmap",), "s2": ("hiring",)}
    assert missing_sessions(db, 10) == []
    db.close()


def test_refresh_merges_with_labels_cached_earlier(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db = DB(tmp_path / "t.db")
    _write(db, "s1", 1, ("roadmaps",))
    save_topics(db, "s0", ("product roadmap",), "llm")

    async def fake(prompt: str, schema: type, **kwargs: object) -> TopicList:
        return TopicList(topics=["Product roadmaps"])

    monkeypatch.setattr(_topics, "generate_structured", fake)
    asyncio.run(_refresh.refresh_topics(db))
    assert load_topics(db)["s1"] == ("product roadmap",)
    db.close()


def test_only_transcript_text_is_sent(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    db = DB(tmp_path / "t.db")
    start = datetime.now(timezone.utc)
    write_session(db, SessionSpec(session_id="s1", started_at=start, numbers=NUMBERS, person_id="alex",
                                  wearer_texts=("we talked budgets",), headline="SECRET HEADLINE",
                                  coach_name="SECRET COACH"))
    sent: list[str] = []

    async def fake(prompt: str, schema: type, **kwargs: object) -> TopicList:
        sent.append(prompt)
        return TopicList(topics=["budgets"])

    monkeypatch.setattr(_topics, "generate_structured", fake)
    asyncio.run(_refresh.refresh_topics(db))
    assert "we talked budgets" in sent[0]
    assert "SECRET" not in sent[0] and "alex" not in sent[0]
    db.close()
