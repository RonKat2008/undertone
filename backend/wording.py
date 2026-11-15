"""Plain-coach wording rules, shared by the day recap and the per-conversation debrief headline.

Pure, no I/O. The coach must sound like a kind friend, not a dashboard: short sentences in second
person, no jargon ("talk ratio", "wpm", "turn", "logged", "metrics", "session"), no percentages, no
ids, no seconds counts, at most a small number when it truly helps.

    problems(text, ...)  -> list of plain reasons (empty = acceptable); fed back to the LLM on retry
    repair(text)         -> the same text with harmless mechanical issues fixed (spaces, markdown,
                            a missing full stop); never changes meaning
"""

from __future__ import annotations

import re
from collections.abc import Iterable

MAX_SENTENCE_WORDS = 18

JARGON: tuple[str, ...] = (
    "talk ratio", "talk share", "ratio", "wpm", "words per minute", "per minute", "turn", "turns",
    "logged", "log", "logs", "metric", "metrics", "session", "sessions", "percent", "percentage",
    "baseline", "data", "datapoint", "interruption rate", "filler rate", "average", "averaged", "kpi",
    "the wearer", "the user", "speaker", "transcript", "rule id", "nudge", "nudges",
)
JUDGING: tuple[str, ...] = (
    "you are a", "you're a", "rambler", "bad listener", "you ramble", "you are bad", "you're bad",
    "poor communicator", "you always", "you never", "lazy", "rude", "annoying", "incompetent",
    "you are too", "you're too", "insecure", "self-centred", "self-centered", "arrogant", "boring",
    "terrible", "awful", "failed", "failure",
)
FIRST_PERSON = re.compile(r"(?<![\w'])(I|I'm|I've|I'd|me|my|mine|we|our)(?![\w'])")
SECOND_PERSON = re.compile(r"(?<![\w'])(you|your|you're|you've|you'd|yours|yourself)(?![\w'])", re.I)
_QUOTED = (re.compile(r'"[^"]*"'), re.compile(r"“[^”]*”"))
_ID_LIKE = re.compile(
    r"(?:\b(?:person|topic|conversation|habit|commitment|session|sample):\S+)"  # graph node ids
    r"|(?:\b[a-z]+_[a-z0-9_]+\b)"  # snake_case ids and rule ids (long_turn, sample_3)
    r"|(?:\b[0-9a-f]{8,}\b)"  # hex / uuid fragments
    r"|(?:\b[a-z]+\d+[a-z0-9]*\b)",  # s1, t04
)
_DIGITS = re.compile(r"\d+(?:[.,]\d+)?")
_SECONDS = re.compile(
    r"(?:\d+(?:\.\d+)?\s*(?:s|sec|secs|seconds?|mins?|minutes?)\b)"
    r"|(?:\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|"
    r"fifty|sixty|ninety|hundred)\s+(?:seconds?|minutes?)\b)",
    re.I,
)
NUMBER_WORDS = frozenset(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "
    "sixteen seventeen eighteen nineteen twenty thirty forty fifty hundred".split())
_SENTENCES = re.compile(r"(?<=[.!?])\s+")
_MARKDOWN = re.compile(r"[*_`#>]+")
_EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿️]")


def _without_quotes(text: str) -> str:
    out = text
    for pattern in _QUOTED:
        out = pattern.sub(" ", out)
    return out


def _without(text: str, protected: Iterable[str]) -> str:
    """Drop protected spans (people's names, topic labels) so their spelling is never judged."""
    out = text
    for item in sorted((p for p in protected if p), key=len, reverse=True):
        out = re.sub(re.escape(item), " ", out, flags=re.I)
    return out


def sentences(text: str) -> list[str]:
    return [s for s in (p.strip() for p in _SENTENCES.split(text.strip())) if s]


def count_numbers(text: str) -> int:
    words = re.findall(r"[A-Za-z]+", text.lower())
    return len(_DIGITS.findall(text)) + sum(1 for w in words if w in NUMBER_WORDS)


def _found(text: str, phrases: Iterable[str]) -> list[str]:
    low = text.lower().replace("’", "'")
    return [p for p in phrases if re.search(rf"(?<![\w']){re.escape(p)}(?![\w'])", low)]


def problems(text: str, *, protected: Iterable[str] = (), max_words: int = MAX_SENTENCE_WORDS,
             max_numbers: int = 1, need_you: bool = True, max_sentences: int = 2) -> list[str]:
    """Why `text` breaks the plain-coach rules; empty when it is fine.

    protected: names and topic labels that may contain anything (digits, underscores).
    need_you: the sentence must talk to the wearer ("you"/"your"); goals may be bare imperatives.
    """
    clean = " ".join(text.split())
    if not clean:
        return ["the sentence is empty"]
    reasons: list[str] = []
    judged = _without(_without_quotes(clean), protected)
    for phrase in _found(judged, JARGON):
        reasons.append(f'uses the jargon word "{phrase}"; say it in everyday words')
    if "%" in judged or "percent" in judged.lower():
        reasons.append("uses a percentage; describe it in words instead")
    if _SECONDS.search(judged):
        reasons.append("counts seconds or minutes; describe it in words instead")
    if _ID_LIKE.search(judged):
        reasons.append("contains an id or code; use names and everyday words only")
    if count_numbers(judged) > max_numbers:
        reasons.append(f"uses more than {max_numbers} number(s); use words like \"a few\" or \"most\"")
    if FIRST_PERSON.search(judged):
        reasons.append('speaks in first person; talk to the wearer as "you"')
    if need_you and not SECOND_PERSON.search(clean):
        reasons.append('does not talk to the wearer; use "you" or "your"')
    for phrase in _found(judged, JUDGING):
        reasons.append(f'judges the person ("{phrase}"); describe what they did, kindly')
    parts = sentences(clean)
    if len(parts) > max_sentences:
        reasons.append(f"has {len(parts)} sentences; use at most {max_sentences}")
    for part in parts:
        n = len(part.split())
        if n > max_words:
            reasons.append(f"a sentence has {n} words; keep each under {max_words + 1}")
    return reasons


def repair(text: str) -> str:
    """Mechanical clean-up only: markdown and emoji out, spaces collapsed, a full stop at the end."""
    out = _EMOJI.sub("", _MARKDOWN.sub("", text))
    out = " ".join(out.replace("\n", " ").split()).strip(" -")
    if out and out[-1] not in ".!?\"”":
        out += "."
    return out[:1].upper() + out[1:] if out else out
