"""Text helpers for live metrics: word counting and heuristic filler detection."""

from __future__ import annotations

import re
from collections.abc import Sequence

_WORD = r"[A-Za-z0-9]+(?:'[A-Za-z]+)?"
_WORD_RE = re.compile(_WORD)
_PUNCT = ",.;:!?—–-"
_TOKEN_RE = re.compile(rf"{_WORD}|[{re.escape(_PUNCT)}]")
_APOSTROPHES = str.maketrans({"’": "'", "‘": "'"})

_LIKE_VERB_CONTEXT: frozenset[str] = frozenset({
    "i", "you", "we", "they", "he", "she", "it", "would", "could", "should",
    "i'd", "you'd", "we'd", "they'd", "do", "does", "did", "don't", "doesn't", "didn't",
    "really", "also", "look", "looks", "looked", "looking", "seem", "seems", "seemed",
    "feel", "feels", "felt", "sound", "sounds", "sounded", "something", "anything",
    "nothing", "more",
})
_DETERMINERS: frozenset[str] = frozenset({
    "what", "this", "that", "a", "any", "some", "which", "the", "every",
})
# filler -> previous tokens that make it a literal (non-filler) use
_DISQUALIFYING_PREV: dict[str, frozenset[str]] = {
    "like": _LIKE_VERB_CONTEXT,
    "you know": frozenset({"do", "did", "don't", "didn't", "if", "would"}),
    "kind of": _DETERMINERS,
    "sort of": _DETERMINERS,
}


def _normalise(text: str) -> str:
    return text.translate(_APOSTROPHES)


def _tokens(text: str) -> tuple[str, ...]:
    return tuple(t.lower() for t in _TOKEN_RE.findall(_normalise(text)))


def _is_punct(token: str) -> bool:
    return len(token) == 1 and token in _PUNCT


def count_words(text: str) -> int:
    """Number of word tokens (contractions like "I'd" count once; dashes do not count)."""
    return len(_WORD_RE.findall(_normalise(text)))


def _like_is_filler(tokens: tuple[str, ...], i: int) -> bool:
    prev = tokens[i - 1] if i > 0 else None
    nxt = tokens[i + 1] if i + 1 < len(tokens) else None
    if prev is None or _is_punct(prev) or (nxt is not None and _is_punct(nxt)):
        return True
    return prev not in _LIKE_VERB_CONTEXT


def _is_filler_use(filler: str, tokens: tuple[str, ...], i: int) -> bool:
    if filler == "like":
        return _like_is_filler(tokens, i)
    disqualifiers = _DISQUALIFYING_PREV.get(filler)
    if disqualifiers is None or i == 0:
        return True
    return tokens[i - 1] not in disqualifiers


def _prepare(filler_words: Sequence[str]) -> tuple[tuple[str, tuple[str, ...]], ...]:
    """(normalised filler, its tokens), longest first, duplicates and empties removed."""
    seen: dict[str, tuple[str, ...]] = {}
    for raw in filler_words:
        name = " ".join(raw.lower().split())
        parts = _tokens(name)
        if name and parts and not any(_is_punct(p) for p in parts):
            seen.setdefault(name, parts)
    return tuple(sorted(seen.items(), key=lambda kv: -len(kv[1])))


def find_fillers(text: str, filler_words: Sequence[str]) -> list[str]:
    """Fillers found in text, in order; longest match wins, matches never overlap."""
    fillers = _prepare(filler_words)
    tokens = _tokens(text)
    if not fillers or not tokens:
        return []
    found: list[str] = []
    i = 0
    while i < len(tokens):
        match = next(
            (
                (name, len(parts)) for name, parts in fillers
                if tokens[i:i + len(parts)] == parts and _is_filler_use(name, tokens, i)
            ),
            None,
        )
        if match is None:
            i += 1
            continue
        found.append(match[0])
        i += match[1]
    return found
