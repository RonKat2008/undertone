"""Pure validation of a debrief draft against the teaching rules (plan.md 4.0, 4.6).

No I/O. `check_draft` returns human-readable reasons that can be appended to a regeneration
prompt; an empty list means the draft is acceptable.
"""

from __future__ import annotations

import re
from collections import Counter
from difflib import SequenceMatcher

from backend.contracts import Metrics
from backend.debrief.wire import MAX_WORDS, DebriefDraft
from backend.state import SessionState

PERSON_JUDGING: tuple[str, ...] = (
    "you are a", "you're a", "rambler", "bad listener", "you ramble", "you are bad", "you're bad",
    "poor communicator", "you are always", "you're always", "you always", "you never", "lazy", "rude",
    "annoying", "incompetent", "you are too", "you're too", "nervous person", "insecure",
    "self-centred", "self-centered", "indecisive", "arrogant", "boring",
)
OTHER_PEOPLE: tuple[str, ...] = (
    "most people", "other people", "than others", "average speaker", "most speakers",
    "the average person", "compared to others", "compared with others", "other candidates",
    "than everyone", "than most",
)
GENERIC_PRAISE: tuple[str, ...] = (
    "great job", "good job", "well done", "you did great", "nice work", "great conversation",
    "you were engaged", "stayed engaged", "great work", "awesome job",
)

NUMBER_WORDS: dict[str, int] = {
    w: i for i, w in enumerate(
        "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
        "fifteen sixteen seventeen eighteen nineteen twenty".split()
    )
}
NUMBER_TOLERANCE = 0.6
REQUIRED_FIELDS: tuple[str, ...] = ("headline_fact", "strength", "one_fix", "if_then")
JUDGED_FIELDS: tuple[str, ...] = ("headline_fact", "strength", "one_fix", "if_then")

_TRANSLATE = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"',
                            "–": "-", "—": "-", "−": "-"})
_NON_WORD = re.compile(r"[^\w\s']+")
_EDGE_APOS = re.compile(r"(?<!\w)'|'(?!\w)")
_NUM = re.compile(r"(?<![\w.])(\d+(?:\.\d+)?)(?:\s*%)?")
_QUOTE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r'"([^"]+)"'),
    re.compile(r"“([^”]+)”"),
    re.compile(r"‘(.+?)’(?!\w)"),
)
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
_QUOTE_MARKS = "\"'“”‘’ \t\n"
_IF_THEN_START = re.compile(r"^(When|If)\b")


def normalize(text: str) -> str:
    """Lowercase; curly quotes/dashes to plain; drop punctuation but keep inner apostrophes."""
    out = text.translate(_TRANSLATE).lower()
    out = _NON_WORD.sub(" ", out.replace("_", " "))
    out = _EDGE_APOS.sub(" ", out)
    return " ".join(out.split())


def wearer_texts(session: SessionState) -> list[str]:
    return [t.text for t in session.turns if t.speaker == "me"]


def sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_SPLIT.split(text.strip()) if s.strip()]


def session_numbers(session: SessionState, metrics: Metrics) -> set[float]:
    """Numbers a headline may legitimately cite for this session."""
    me = [t for t in session.turns if t.speaker == "me"]
    fillers = [f.lower() for t in me for f in t.fillers]
    duration = session.duration_s
    nums: set[float] = {
        float(round(metrics.talk_ratio * 100)), float(metrics.interruptions), float(metrics.questions),
        round(metrics.fillers_per_min, 1), float(round(metrics.fillers_per_min)), float(round(metrics.wpm)),
        float(len(me)), float(len(fillers)), float(round(duration)), round(duration / 60, 1),
        float(round(duration / 60)), float(len(session.nudges)), float(len(session.bookmarks)),
    }
    if me:
        per_turn = len(fillers) / len(me)
        nums.update({round(per_turn, 1), float(round(per_turn))})
    nums.update(float(round(t.end - t.start)) for t in me)
    nums.update(float(len(t.fillers)) for t in me)
    nums.update(float(c) for c in Counter(fillers).values())
    return nums


def numbers_in(text: str) -> list[float]:
    """Numbers cited in text, in order: digits (incl. decimals, "68%") and words zero..twenty."""
    found: list[tuple[int, float]] = [(m.start(), float(m.group(1))) for m in _NUM.finditer(text)]
    for m in re.finditer(r"[A-Za-z]+", text):
        word = m.group(0).lower()
        if word in NUMBER_WORDS:
            found.append((m.start(), float(NUMBER_WORDS[word])))
    return [n for _, n in sorted(found)]


def quotes_in(text: str) -> list[str]:
    """Quoted spans of at least two words, in order of appearance."""
    found: list[tuple[int, str]] = []
    for pattern in _QUOTE_PATTERNS:
        for m in pattern.finditer(text):
            span = m.group(1).strip()
            if len(span.split()) >= 2:
                found.append((m.start(), span))
    return [q for _, q in sorted(found)]


def _contains(haystack_norm: str, needle_norm: str) -> bool:
    return bool(needle_norm) and f" {needle_norm} " in f" {haystack_norm} "


def is_real_quote(quote: str, session: SessionState) -> bool:
    nq = normalize(quote)
    return any(_contains(normalize(t.text), nq) for t in session.turns)


def headline_has_evidence(headline: str, session: SessionState, metrics: Metrics) -> bool:
    known = session_numbers(session, metrics)
    for n in numbers_in(headline):
        if any(abs(n - k) <= NUMBER_TOLERANCE or round(n, 1) == round(k, 1) for k in known):
            return True
    return any(is_real_quote(q, session) for q in quotes_in(headline))


def similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, normalize(a), normalize(b)).ratio()


def verify_quote(quote: str, wearer: list[str]) -> str:
    """Return the quote if it is word for word from a wearer turn, else the closest real sentence."""
    if not wearer:
        return ""
    stripped = quote.strip(_QUOTE_MARKS)
    nq = normalize(stripped)
    if nq and any(_contains(normalize(t), nq) for t in wearer):
        return stripped
    candidates = [s for t in wearer for s in sentences(t)]
    if not candidates:
        return ""
    return max(candidates, key=lambda s: similarity(stripped, s))


def _strip_quotes(text: str) -> str:
    """Remove quoted spans so the wearer's own words are not judged as the coach's wording."""
    out = text
    for pattern in _QUOTE_PATTERNS:
        out = pattern.sub(" ", out)
    return out


def phrases_found(text: str, phrases: tuple[str, ...]) -> list[str]:
    norm = normalize(_strip_quotes(text))
    return [p for p in phrases if re.search(rf"(?<!\w){re.escape(normalize(p))}(?!\w)", norm)]


def _clip(text: str, n: int = 60) -> str:
    text = " ".join(text.split())
    return text if len(text) <= n else text[: n - 3] + "..."


def check_draft(draft: DebriefDraft, session: SessionState, metrics: Metrics) -> list[str]:
    reasons: list[str] = []
    fields: dict[str, str] = {
        "headline_fact": draft.headline_fact, "strength": draft.strength,
        "one_fix": draft.one_fix, "if_then": draft.if_then,
    }
    for name in REQUIRED_FIELDS:
        if not fields[name].strip():
            reasons.append(f"{name} is empty; write one sentence")
    if wearer_texts(session) and not draft.best_moment_quote.strip():
        reasons.append("best_moment_quote is empty; copy one sentence word for word from a ME turn")
    if fields["headline_fact"].strip() and not headline_has_evidence(draft.headline_fact, session, metrics):
        reasons.append("headline_fact must cite a number from the session's metrics or a word-for-word "
                       f'quote from the transcript; got "{_clip(draft.headline_fact)}"')
    if_then = draft.if_then.strip()
    if if_then and not _IF_THEN_START.match(if_then):
        reasons.append(f'if_then must start with "When" or "If"; got "{_clip(if_then, 30)}"')
    for name in JUDGED_FIELDS:
        for phrase in phrases_found(fields[name], PERSON_JUDGING):
            reasons.append(f'{name} judges the person ("{phrase}"); describe what the wearer did, not a trait')
    other_fields = dict(fields, vs_last_time=draft.vs_last_time or "")
    for name, text in other_fields.items():
        for phrase in phrases_found(text, OTHER_PEOPLE):
            reasons.append(f'{name} compares with other people ("{phrase}"); compare only with the '
                           "wearer's own past sessions")
    for phrase in phrases_found(draft.strength, GENERIC_PRAISE):
        reasons.append(f'strength is generic praise ("{phrase}"); name one specific thing that happened, '
                       "ideally with a quote")
    for name, limit in MAX_WORDS.items():
        count = len(fields.get(name, "").split())
        if count > limit:
            reasons.append(f"{name} has {count} words; the limit is {limit}")
    return reasons
