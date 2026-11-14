"""Topic extraction: one LLM call per session with a deterministic keyword fallback.

Only the transcript text goes to the LLM (no names, metrics or coach data). Labels are short,
lower-case, and merged against labels already known so near-duplicates share one slug.
"""

from __future__ import annotations

import logging
import re
from collections import Counter
from collections.abc import Iterable, Sequence
from difflib import SequenceMatcher
from itertools import pairwise
from typing import Literal

from pydantic import BaseModel, Field

from backend.llm import LLMUnavailable, generate_structured

log = logging.getLogger(__name__)

MAX_TOPICS = 5
MAX_LABEL_CHARS = 40
MAX_LABEL_WORDS = 4
MAX_TRANSCRIPT_CHARS = 12_000
LLM_TIMEOUT_S = 20.0
NEAR_DUPLICATE = 0.88
MIN_COUNT = 2  # a keyword must recur to count as a topic
TopicSource = Literal["llm", "keywords"]

STOPWORDS: frozenset[str] = frozenset("""
a about above after again against all almost also am an and any are aren around as at back be because
been before being below between both but by can cannot could couldn did didn do does doesn doing don done
down during each either else even ever every few for from further get gets getting go goes going gone got
had hadn has hasn have haven having he her here hers herself him himself his how however i if in into is
isn it its itself just keep kind least less let lets like likes liked lot lots made make makes making many
may maybe me might mine more most much must my myself need needs never next no nor not now of off often
okay ok on once one only or other others our ours ourselves out over own pretty probably quite rather
really right said same say says see seem seems she should shouldn since so some something sort still such
sure take tell than that the their theirs them themselves then there these they thing things think
thinking this those though through thought to too try trying under until up upon us very was wasn way we
well were weren what when where whether which while who whom whose why will with won would wouldn yeah yes
yet you your yours yourself yourselves um uh hmm mm basically actually literally anyway mean know
want wanted wants come came look looks looked looking feel felt give gave put sounds sound good great
fine bad big little new old first last long great tried trying talk talked talking ask asked tell told
start started finally again honestly already always last week weeks month day days today tomorrow
yesterday time times year years lot part bit stuff guess hear heard instead alive local whole
cut write read send run stop help move pick split wait waiting lead push shard happen happened use used
let's i'm i've i'll i'd you're you've we're we've they're it's that's there's what's don't didn't can't
won't isn't doesn't
""".split())

_WORD = re.compile(r"[a-z][a-z0-9'\-]*")
_SPLIT = re.compile(r"[.,;:!?()\"\n]+")


class TopicList(BaseModel):
    """LLM output: up to five short topic labels."""

    topics: list[str] = Field(default_factory=list, max_length=MAX_TOPICS)


def slugify(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", label.lower()).strip("-")[:48].strip("-")


def _singular(word: str) -> str:
    if len(word) > 3 and word.endswith("s") and not word.endswith(("ss", "us", "is", "ics")):
        return word[:-1]
    return word


def _key(label: str) -> str:
    words = [_singular(w) for w in _WORD.findall(label.lower()) if w not in STOPWORDS]
    return " ".join(words)


def clean_label(raw: str) -> str:
    """Lower-case, single-spaced, at most MAX_LABEL_WORDS words; "" if nothing usable is left."""
    words = _WORD.findall(raw.lower().replace("_", " "))[:MAX_LABEL_WORDS]
    label = " ".join(words).strip("-' ")
    if not label or not _key(label) or len(label) > MAX_LABEL_CHARS:
        return ""
    return label


def _same(a: str, b: str) -> bool:
    ka, kb = _key(a), _key(b)
    return ka == kb or SequenceMatcher(None, ka, kb).ratio() >= NEAR_DUPLICATE


def merge_labels(new: Iterable[str], existing: Sequence[str]) -> tuple[str, ...]:
    """Clean, dedupe and map each label onto an existing near-duplicate. Order kept, max 5."""
    known = list(existing)
    out: list[str] = []
    for raw in new:
        label = clean_label(raw)
        if not label:
            continue
        label = next((k for k in known if _same(label, k)), label)
        if all(not _same(label, o) for o in out):
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
        for word in _WORD.findall(chunk):
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
        surface.setdefault(_singular(w), w)
    for a, b in pairs:
        surface.setdefault(f"{_singular(a)} {_singular(b)}", f"{a} {b}")
    singles = Counter(_singular(w) for w in words)
    doubles = Counter(f"{_singular(a)} {_singular(b)}" for a, b in pairs)
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
