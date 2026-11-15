"""Gemini wording for the day recap. The model only rewords findings chosen in code, from a compact
numbers-only fact sheet (no transcripts). Its draft is repaired, then checked against the plain
wording rules (backend/wording.py); a failing draft is retried once with the reasons, and a second
failure means the caller uses the rule wording.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Sequence
from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field

from backend import wording
from backend.llm import LLMUnavailable, generate_structured
from backend.recap._facts import Group, readings
from backend.recap._findings import Contrast, Finding, GoalPick, item_text

log = logging.getLogger(__name__)

TIMEOUT_S = 15.0
MAX_ATTEMPTS = 2
HEADLINE_WORDS = 20

FACT_LABELS: dict[str, str] = {
    "interrupt": "times you cut in, per chat", "share_high": "your share of the talking (0-1)",
    "share_low": "your share of the talking (0-1)", "questions": "questions you asked, per chat",
    "pace": "your words per minute", "fillers": "filler words per minute of your speech",
    "hedges": "hedge phrases you said",
}


class _Wire(BaseModel):
    model_config = ConfigDict(extra="ignore")


class DraftLine(_Wire):
    key: str = Field(description="the candidate key this sentence rewords, e.g. good1, work2, goal1")
    text: str


class RecapDraft(_Wire):
    headline: str
    went_well: list[DraftLine] = Field(default_factory=list)
    work_on: list[DraftLine] = Field(default_factory=list)
    goals: list[DraftLine] = Field(default_factory=list)


@dataclass(frozen=True)
class Worded:
    headline: str
    went_well: dict[str, str]  # finding key -> text, in the model's order
    work_on: dict[str, str]
    goals: dict[str, str]


RULES = """WRITING RULES (answers that break any of them are rejected):
- Write like a kind, honest friend talking to the wearer: second person ("you"), plain everyday words a 12-year-old understands.
- Each sentence under 18 words. The headline is ONE sentence under 20 words.
- No numbers in sentences except at most one small number in a goal if it truly helps. No percentages. Never count seconds or minutes.
- Never use these words: talk ratio, ratio, wpm, words per minute, per minute, turn, turns, logged, metric, metrics, session, sessions, data, average, baseline, nudge, transcript, speaker.
- No ids or codes. Use people's names exactly as given. Never name a person on a line that is not about them.
- Say only what the candidate lines say. Do not add new facts, feelings or reasons ("things got tense" only if the facts say so).
- went_well and work_on: one sentence each, starting with "You". goals: one simple action each, like "Pause for a breath before you answer Alex."
- Use every candidate key exactly once in its own list, in any order. No markdown, no emoji."""


def _group_line(g: Group, facts: dict[str, float | None]) -> str:
    who = g.name or (f"someone (chat about {g.topic_label})" if g.topic_label else "someone")
    kind = f", {g.relationship}" if g.relationship else ""
    nums = "; ".join(f"{FACT_LABELS[k]} {v:g}" for k, v in facts.items() if v is not None)
    return f"- {who}{kind}: {len(g.convs)} chat(s); {nums}"


def build_prompt(groups: Sequence[Group], good: Sequence[Finding], bad: Sequence[Finding],
                 goals: Sequence[GoalPick], contrast: Contrast | None, rule_headline: str,
                 reasons: Sequence[str] = ()) -> str:
    multiple = len(groups) > 1
    people = [_group_line(g, {r.measure: (round(r.value, 2) if r.value is not None else None)
                              for r in readings(g)}) for g in groups if g.has_evidence]
    sections = [
        "You are Undertone, a friendly speech coach writing the wearer's end-of-day recap.",
        "TODAY'S FACTS (numbers are for you only, never repeat them):\n" + "\n".join(people),
        "WENT_WELL candidates (key: meaning):\n" + ("\n".join(f"- {f.key}: {item_text(f, multiple)}" for f in good)
                                                    or "none (went_well must be empty)"),
        "WORK_ON candidates (key: meaning):\n" + ("\n".join(f"- {f.key}: {item_text(f, multiple)}" for f in bad)
                                                  or "none (work_on must be empty)"),
        "GOAL candidates for tomorrow (key: meaning):\n" + "\n".join(f"- {p.key}: {p.text}" for p in goals),
        ("CONTRAST the numbers support (use it in the headline): " + rule_headline) if contrast else
        ("No contrast between people is supported; do not contrast two people. Headline meaning: " + rule_headline),
        RULES,
    ]
    if reasons:
        sections.append("Your previous answer was rejected for:\n" + "\n".join(f"- {r}" for r in reasons)
                        + "\nFix every one.")
    return "\n\n".join(sections)


def _names_in(text: str, names: Sequence[str]) -> set[str]:
    return {n for n in names if re.search(rf"(?<!\w){re.escape(n)}(?!\w)", text)}


def _check_list(label: str, lines: list[DraftLine], wanted: dict[str, str | None], protected: list[str],
                names: list[str], need_you: bool) -> tuple[dict[str, str], list[str]]:
    """wanted: key -> the person's name the line is about (or None)."""
    reasons: list[str] = []
    out: dict[str, str] = {}
    for line in lines:
        text = wording.repair(line.text)
        if line.key not in wanted or line.key in out:
            reasons.append(f'{label} uses an unknown or repeated key "{line.key}"')
            continue
        for p in wording.problems(text, protected=protected, need_you=need_you, max_sentences=1,
                                  max_numbers=1 if label == "goals" else 0):
            reasons.append(f'{label} {line.key}: {p}')
        own = wanted[line.key]
        stray = _names_in(text, names) - ({own} if own else set())
        if stray:
            reasons.append(f"{label} {line.key} names someone it is not about ({', '.join(sorted(stray))})")
        out[line.key] = text
    missing = [k for k in wanted if k not in out]
    if missing:
        reasons.append(f"{label} is missing keys {', '.join(missing)}")
    return out, reasons


def check_draft(draft: RecapDraft, groups: Sequence[Group], good: Sequence[Finding], bad: Sequence[Finding],
                goals: Sequence[GoalPick], contrast: Contrast | None) -> tuple[Worded, list[str]]:
    names = [g.name for g in groups if g.name]
    protected = names + [g.topic_label for g in groups if g.topic_label]
    headline = wording.repair(draft.headline)
    reasons = [f"headline: {p}" for p in wording.problems(headline, protected=protected, max_sentences=1,
                                                         max_words=HEADLINE_WORDS, max_numbers=0)]
    allowed = ({contrast.easy.name, contrast.hard.group.name} if contrast else
               {f.group.name for f in [*good[:1], *bad[:1]]}) - {None}
    stray = _names_in(headline, names) - allowed
    if stray:
        reasons.append(f"headline names people the facts do not support ({', '.join(sorted(stray))})")
    ww, r1 = _check_list("went_well", draft.went_well, {f.key: f.group.name for f in good}, protected, names, True)
    wo, r2 = _check_list("work_on", draft.work_on, {f.key: f.group.name for f in bad}, protected, names, True)
    gl, r3 = _check_list("goals", draft.goals, {p.key: p.group.name if p.group else None for p in goals},
                         protected, names, False)
    return Worded(headline, ww, wo, gl), [*reasons, *r1, *r2, *r3]


async def word(groups: Sequence[Group], good: Sequence[Finding], bad: Sequence[Finding],
               goals: Sequence[GoalPick], contrast: Contrast | None, rule_headline: str) -> Worded | None:
    """Gemini's wording, or None (no key, failure, or two drafts that break the rules)."""
    reasons: list[str] = []
    for attempt in range(MAX_ATTEMPTS):
        prompt = build_prompt(groups, good, bad, goals, contrast, rule_headline, reasons)
        try:
            draft = await generate_structured(prompt, RecapDraft, timeout_s=TIMEOUT_S)
        except LLMUnavailable as exc:
            log.warning("day recap LLM unavailable: %s", exc)
            return None
        worded, reasons = check_draft(draft, groups, good, bad, goals, contrast)
        if not reasons:
            return worded
        log.warning("day recap draft rejected (attempt %d): %s", attempt + 1, "; ".join(reasons))
    return None
