"""Who was the other person? A name from the transcript, only when it is clear.

    name = await other_name(turns, wearer_name=None)   # NameGuess | None; never raises

One `generate_structured` call (the wearer is ME, the other is OTHER; a name only from a
self-introduction by OTHER or ME addressing OTHER by name, never a guess, never the wearer's
own name), and a rule fallback for the simple cases: "I'm Dylan" said by OTHER, or a vocative
said by ME ("Hello, Dylan", "Thanks, Priya."). A name OTHER uses for ME is the wearer's name,
so it is excluded from both.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, Field

from backend.contracts import TurnFinalEvent

log = logging.getLogger("undertone.voices")

NAME_TIMEOUT_S = 20.0
MIN_CONFIDENCE = 0.8
MAX_INPUT_CHARS = 6000
NAME_RE = r"([A-Z][a-z]{1,20}(?:[-'][A-Z][a-z]{1,20})?)"
GREETINGS = r"(?:hi|hey|hello|thanks|thank you|cheers|bye|goodbye|morning|good morning|good afternoon|" \
            r"good evening|nice to meet you|great to meet you|good to see you|see you|sorry|okay|ok|right|yes|no|well)"
VOCATIVE_RE = re.compile(rf"\b(?i:{GREETINGS}),?\s+{NAME_RE}\s*[.!?,]")
INTRO_RE = re.compile(rf"\b(?i:i'm|i am|my name is|my name's|this is|call me)\s+{NAME_RE}\b")
TRAILING_VOCATIVE_RE = re.compile(rf",\s+{NAME_RE}\s*[.!?]\s*$")
LEADING_VOCATIVE_RE = re.compile(rf"^\s*{NAME_RE},\s+(?:[a-z]|I\b)")  # "Priya, have you..."; not "Lisbon, Porto"
NOT_NAMES: frozenset[str] = frozenset({
    "sorry", "sure", "here", "fine", "good", "great", "glad", "just", "back", "done", "okay", "right",
    "everyone", "guys", "man", "mate", "buddy", "dude", "sir", "madam", "there", "all", "both", "you",
    "going", "not", "so", "really", "afraid", "happy", "excited", "tired", "late", "new", "well", "thanks",
    "today", "tomorrow", "yesterday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
    "sunday", "honestly", "actually", "still", "also", "very", "pretty", "kind", "doing", "working", "busy",
    "yeah", "yes", "no", "hey", "hi", "hello", "look", "listen", "anyway", "basically", "maybe", "then", "now",
    "first", "second", "finally", "plus", "but", "and", "because", "sounds", "perfect", "exactly", "totally",
    "absolutely", "cool", "nice", "awesome", "wow", "oh", "um", "uh", "hmm", "alright", "please", "sorry",
})


class NameAnswer(BaseModel):
    """What the model returns: a name only when stated or used in the transcript."""

    other_name: str | None = Field(default=None, max_length=60)
    evidence: str = Field(default="", max_length=300)
    source: Literal["self_introduction", "addressed_by_me", "none"] = "none"
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)


@dataclass(frozen=True)
class NameGuess:
    name: str
    source: str  # llm | rules
    evidence: str
    confidence: float


Generate = Callable[..., Awaitable[NameAnswer]]

PROMPT = """You read an automatic transcript of a conversation recorded by a microphone worn by ME.
OTHER is the other person. Find OTHER's first name, but ONLY if it is clearly stated in the
transcript: OTHER introduces themselves ("I'm Dylan", "my name is Priya"), or ME addresses OTHER
by name ("Thanks, Dylan", "Dylan, what do you think?").
Rules:
- Never guess. If no name for OTHER is said, return other_name null, source "none", confidence 0.
- A name that OTHER uses to address ME is ME's name, not OTHER's: never return it.
{wearer_rule}- Names of people who are only talked about (not present) are not OTHER's name.
- Return just the first name as written, with evidence: the exact line it came from.
Confidence: 0.9 or more only when the line leaves no doubt.

Transcript:
{transcript}
"""


def _transcript(turns: Sequence[TurnFinalEvent]) -> str:
    lines = [f"{'ME' if t.speaker == 'me' else 'OTHER'}: {t.text.strip()}" for t in turns if t.text.strip()]
    return "\n".join(lines)[:MAX_INPUT_CHARS]


def _clean(name: str | None) -> str | None:
    if not name:
        return None
    first = name.strip().split()[0].strip(".,!?;:'\"") if name.strip() else ""
    if not re.fullmatch(r"[A-Za-z][A-Za-z'-]{1,20}", first) or first.lower() in NOT_NAMES:
        return None
    return first[0].upper() + first[1:]


def names_for_me(turns: Sequence[TurnFinalEvent]) -> set[str]:
    """Names OTHER uses to address ME (vocatives in OTHER's lines): the wearer's names."""
    found: set[str] = set()
    for t in turns:
        if t.speaker == "other":
            found |= {n.lower() for n in _vocatives(t.text)}
    return found


def _vocatives(text: str) -> list[str]:
    hits = [m.group(1) for m in VOCATIVE_RE.finditer(text)]
    hits += [m.group(1) for m in TRAILING_VOCATIVE_RE.finditer(text.strip())]
    hits += [m.group(1) for m in LEADING_VOCATIVE_RE.finditer(text)]
    return [n for n in (_clean(h) for h in hits) if n]


def rule_name(turns: Sequence[TurnFinalEvent], wearer_name: str | None = None) -> NameGuess | None:
    """'I'm X' said by OTHER, or a vocative said by ME. One distinct name only."""
    excluded = names_for_me(turns) | ({wearer_name.lower()} if wearer_name else set())
    found: dict[str, str] = {}
    for t in turns:
        if t.speaker == "other":
            cands = [_clean(m.group(1)) for m in INTRO_RE.finditer(t.text)]
        else:
            cands = _vocatives(t.text)
        for n in cands:
            if n and n.lower() not in excluded:
                found.setdefault(n.lower(), t.text.strip())
    if len(found) != 1:
        return None
    key, line = next(iter(found.items()))
    return NameGuess(key[0].upper() + key[1:], "rules", line[:300], 0.85)


async def llm_name(turns: Sequence[TurnFinalEvent], wearer_name: str | None,
                   generate: Generate | None = None) -> NameGuess | None:
    """Raises on any LLM failure (the caller falls back to rules)."""
    if generate is None:
        from backend.llm import generate_structured as generate  # noqa: PLC0415 - optional dependency
    rule = f"- ME's own name is {wearer_name}: never return it.\n" if wearer_name else ""
    prompt = PROMPT.format(wearer_rule=rule, transcript=_transcript(turns))
    ans = await generate(prompt, NameAnswer, timeout_s=NAME_TIMEOUT_S)
    name = _clean(ans.other_name)
    excluded = names_for_me(turns) | ({wearer_name.lower()} if wearer_name else set())
    if name is None or ans.source == "none" or ans.confidence < MIN_CONFIDENCE or name.lower() in excluded:
        return None
    if name.lower() not in _transcript(turns).lower():  # must literally appear: no invented names
        return None
    return NameGuess(name, "llm", ans.evidence, round(ans.confidence, 2))


async def other_name(turns: Sequence[TurnFinalEvent], wearer_name: str | None = None,
                     generate: Generate | None = None) -> NameGuess | None:
    """The other person's name, or None. The rules decide when the LLM is unavailable. Never raises."""
    if not any(t.text.strip() for t in turns):
        return None
    try:
        return await llm_name(turns, wearer_name, generate)
    except Exception as exc:  # noqa: BLE001 - LLMUnavailable or anything else: rules decide
        log.info("name extraction: LLM unavailable (%s); using rules", type(exc).__name__)
    try:
        return rule_name(turns, wearer_name)
    except Exception:  # noqa: BLE001
        log.exception("name extraction rules failed")
        return None
