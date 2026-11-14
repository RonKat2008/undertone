"""Unit tests for backend.metrics.text (word counting and filler detection)."""

from __future__ import annotations

import pytest

from backend.metrics.text import count_words, find_fillers

DEFAULT_FILLERS: tuple[str, ...] = (
    "um", "uh", "like", "basically", "you know", "actually",
    "sort of", "kind of", "i mean", "literally",
)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("", 0),
        ("hello world", 2),
        ("I'd check — maybe", 3),
        ("costs, like, basically 42 dollars.", 5),
        ("don't stop", 2),
        ("I’d go", 2),
        ("  — , . !", 0),
    ],
)
def test_count_words(text: str, expected: int) -> None:
    assert count_words(text) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("I like coffee", []),
        ("it looks like rain", []),
        ("I would like a refund", []),
        ("we'd like that", []),
        ("And, like, I'd check", ["like"]),
        ("Like, whatever", ["like"]),
        ("it was like huge", ["like"]),
        ("costs, like, basically", ["like", "basically"]),
        ("that is likely", []),
        ("I feel like it", []),
    ],
)
def test_like_heuristics(text: str, expected: list[str]) -> None:
    assert find_fillers(text, DEFAULT_FILLERS) == expected


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("do you know the time", []),
        ("if you know what I mean", ["i mean"]),
        ("it was, you know, fine", ["you know"]),
        ("You know it is late", ["you know"]),
        ("what kind of store", []),
        ("a sort of plan", []),
        ("it's kind of slow", ["kind of"]),
        ("I mean it sort of works", ["i mean", "sort of"]),
    ],
)
def test_multiword_heuristics(text: str, expected: list[str]) -> None:
    assert find_fillers(text, DEFAULT_FILLERS) == expected


def test_default_list_on_real_sentence() -> None:
    text = "Um, okay. Is that drop across all stores?"
    assert find_fillers(text, DEFAULT_FILLERS) == ["um"]


def test_word_boundaries_and_case() -> None:
    assert find_fillers("um umbrella UM", DEFAULT_FILLERS) == ["um", "um"]


def test_text_order_preserved() -> None:
    text = "Uh, basically we literally um shipped it"
    assert find_fillers(text, DEFAULT_FILLERS) == ["uh", "basically", "literally", "um"]


def test_empty_inputs() -> None:
    assert find_fillers("", DEFAULT_FILLERS) == []
    assert find_fillers("um like uh", []) == []


def test_filler_words_normalised() -> None:
    assert find_fillers("You  KNOW, right", ["  You   Know "]) == ["you know"]


def test_longest_match_preferred_and_no_overlap() -> None:
    fillers = ("i", "i mean", "mean")
    assert find_fillers("I mean it", fillers) == ["i mean"]


def test_multiword_does_not_span_punctuation() -> None:
    assert find_fillers("you, know", ["you know"]) == []
