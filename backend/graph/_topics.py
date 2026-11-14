"""Topic extraction: one LLM call per session with a deterministic keyword fallback.

Only the transcript text goes to the LLM (no names, metrics or coach data). Labels are short,
lower-case, and merged against labels already known (rules in _merge.py) so near-duplicates
share one slug; generic nouns alone ("place", "issue") are dropped.
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from collections.abc import Iterable, Sequence
from itertools import pairwise
from typing import Literal

from pydantic import BaseModel, Field

from backend.graph._merge import STOPWORDS, WORD, is_weak, same_topic, singular
from backend.llm import LLMUnavailable, generate_structured

log = logging.getLogger(__name__)

MAX_TOPICS = 5
MAX_LABEL_CHARS = 40
MAX_LABEL_WORDS = 4
MAX_TRANSCRIPT_CHARS = 12_000
LLM_TIMEOUT_S = 20.0
MIN_COUNT = 2  # a keyword must recur to count as a topic
TopicSource = Literal["llm", "keywords"]

_SPLIT = re.compile(r"[.,;:!?()\"\n]+")


class TopicList(BaseModel):
    """LLM output: up to five short topic labels."""

    topics: list[str] = Field(default_factory=list, max_length=MAX_TOPICS)


def slugify(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")[:48].strip("-")


def clean_label(raw: str) -> str:
    """Lower-case, single-spaced, at most MAX_LABEL_WORDS words; "" if nothing usable is left."""
    words = WORD.findall(raw.lower().replace("_", " "))[:MAX_LABEL_WORDS]
    label = " ".join(words).strip("-' ")
    if not label or is_weak(label) or len(label) > MAX_LABEL_CHARS:
        return ""
    return label


def merge_labels(new: Iterable[str], existing: Sequence[str]) -> tuple[str, ...]:
    """Clean, dedupe and map each label onto an existing near-duplicate. Order kept, max 5."""
    known = list(existing)
    out: list[str] = []
    for raw in new:
        label = clean_label(raw)
        if not label:
            continue
        label = next((k for k in known if same_topic(label, k)), label)
        if all(not same_topic(label, o) for o in out):
            out.append(label)
            known.append(label)
        if len(out) == MAX_TOPICS:
            break
    return tuple(out)


def _not_a_noun(word: str) -> bool:
    """Cheap filter for adverbs, past-tense verbs and numbers."""
    return word.endswith("ly") or (len(word) > 4 and word.endswith("ed")) or word[0].isdigit()


def _phrases(text: str) -> list[list[str]]:
    """Runs of consecutive content words (stopwords and punctuation break a run)."""
    runs: list[list[str]] = []
    for chunk in _SPLIT.split(text.lower()):
        run: list[str] = []
        for word in WORD.findall(chunk):
            word = word.strip("-'")
            if len(word) < 3 or word in STOPWORDS or _not_a_noun(word):
                if run:
                    runs.append(run)
                run = []
            else:
                run.append(word)
        if run:
            runs.append(run)
    return runs


def keyword_topics(text: str, limit: int = MAX_TOPICS) -> tuple[str, ...]:
    """Frequent noun-phrase-ish terms: recurring two-word phrases first, then recurring words.
    Counted on singular forms, shown in the first surface form seen."""
    runs = _phrases(text)
    words = [w for run in runs for w in run]
    pairs = [(a, b) for run in runs for a, b in pairwise(run)]
    surface: dict[str, str] = {}
    for w in words:
        surface.setdefault(singular(w), w)
    for a, b in pairs:
        surface.setdefault(f"{singular(a)} {singular(b)}", f"{a} {b}")
    singles = Counter(singular(w) for w in words)
    doubles = Counter(f"{singular(a)} {singular(b)}" for a, b in pairs)
    first = {key: i for i, key in reversed(list(enumerate(surface)))}
    top_pairs = sorted((p for p, n in doubles.items() if n >= MIN_COUNT), key=lambda p: (-doubles[p], first[p]))
    picked = top_pairs[:limit]
    used = {w for p in picked for w in p.split()}
    top_words = sorted((w for w, n in singles.items() if n >= MIN_COUNT and w not in used),
                       key=lambda w: (-singles[w], first[w]))
    return merge_labels([surface[k] for k in [*picked, *top_words]], ())[:limit]


def _prompt(transcript: str) -> str:
    return (
        "List up to 5 topics this conversation was about. Each topic is a short noun phrase of "
        "1 to 3 lower-case words (for example 'product roadmap', 'lisbon trip', 'hiring'). "
        "Topics are subjects discussed, never people's names, feelings or speaking habits. "
        "Return JSON {\"topics\": [...]}.\n\nTranscript:\n" + transcript[:MAX_TRANSCRIPT_CHARS]
    )


async def llm_topics(transcript: str) -> tuple[str, ...]:
    """One structured call. Raises LLMUnavailable on any failure (caller falls back)."""
    result = await generate_structured(_prompt(transcript), TopicList, thinking="low", timeout_s=LLM_TIMEOUT_S)
    return tuple(result.topics)


async def extract_topics(transcript: str, existing: Sequence[str]) -> tuple[tuple[str, ...], TopicSource]:
    """LLM labels merged against `existing`; keywords if the LLM fails or returns nothing usable."""
    if transcript.strip():
        try:
            labels = merge_labels(await llm_topics(transcript), existing)
        except LLMUnavailable as exc:
            log.info("topic extraction falls back to keywords: %s", exc)
        else:
            if labels:
                return labels, "llm"
    return merge_labels(keyword_topics(transcript), existing), "keywords"
