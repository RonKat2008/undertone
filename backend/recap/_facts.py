"""Pure aggregation of one day's conversations into groups (one per person, or one untagged
conversation) and plain good / ok / bad verdicts per measure.

Bands are fixed coaching targets, not comparisons with other people. A verdict of None means there
is too little evidence for that measure (too little speech, too short a conversation): nothing is
said about it, and a goal on it cannot be judged.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal

from backend.debrief.prompt import HEDGE_PHRASES
from backend.graph._rows import Conversation
from backend.reports._measures import measure
from backend.reports._shared import topic_labels, topic_slugs

Verdict = Literal["good", "ok", "bad"]
MeasureKey = Literal["interrupt", "share_high", "share_low", "questions", "pace", "fillers", "hedges"]
MEASURES: tuple[MeasureKey, ...] = ("interrupt", "share_high", "share_low", "questions", "pace", "fillers",
                                    "hedges")
# Which reports measure (backend/reports/_measures.py) backs each key; hedges are counted here.
REPORT_METRIC: dict[MeasureKey, str] = {
    "interrupt": "interruptions", "share_high": "talk_ratio", "share_low": "talk_ratio",
    "questions": "questions", "pace": "wpm", "fillers": "fillers_per_min",
}

MIN_SPOKEN_MIN = 0.3  # a group with less of the wearer's speech than this says nothing
MIN_OTHER_LINES = 2  # "let them finish" needs the other person to have spoken a few times
MIN_TOGETHER_MIN = 2.0  # per conversation, before "no questions" or "barely spoke" is fair
MIN_PACE_SPOKEN_MIN = 0.5
MIN_FILLER_SPOKEN_MIN = 1.0
INTERRUPT_BAD = 2.0  # per conversation
SHARE_GOOD = (0.30, 0.60)
SHARE_HIGH_BAD = 0.68
SHARE_LOW_BAD = 0.15
QUESTIONS_GOOD = 2.0  # per conversation
PACE_GOOD = (110.0, 165.0)
PACE_BAD = 175.0
FILLERS_GOOD = 1.5  # per minute of the wearer's speech
FILLERS_BAD = 4.0
HEDGES_BAD_PER_MIN = 1.0
HEDGES_BAD_MIN_COUNT = 3


@dataclass(frozen=True)
class Group:
    key: str  # person_id, or "conv:<session_id>" for an untagged conversation
    person_id: str | None
    name: str | None
    relationship: str | None  # relationship kind, when known and not "unknown"
    convs: tuple[Conversation, ...]  # oldest first
    topic_id: str | None
    topic_label: str | None

    @property
    def spoken_min(self) -> float:
        return sum(c.minutes_spoken for c in self.convs)

    @property
    def together_min(self) -> float:
        return sum(c.duration_s for c in self.convs) / 60

    @property
    def other_lines(self) -> int:
        return sum(1 for c in self.convs for ln in c.lines if ln.speaker == "other")

    @property
    def has_evidence(self) -> bool:
        return self.spoken_min >= MIN_SPOKEN_MIN


@dataclass(frozen=True)
class Reading:
    """One measure for one group: the value, the verdict and how strong it is (for ranking)."""

    measure: MeasureKey
    value: float | None
    verdict: Verdict | None
    strength: float = 0.0  # >= 1 for a clear good or bad, 0 otherwise
    phrase: str = ""  # hedges only: the hedge phrase said most


def _topic(convs: Sequence[Conversation]) -> tuple[str | None, str | None]:
    labels = topic_labels(convs)
    for c in reversed(convs):  # the newest conversation's first topic
        for slug in topic_slugs(c):
            return slug, labels.get(slug)
    return None, None


def groups_for(convs: Sequence[Conversation], names: dict[str, str], kinds: dict[str, str]) -> list[Group]:
    """Tagged conversations grouped per person (first appearance order), untagged ones alone."""
    order: list[str] = []
    by_key: dict[str, list[Conversation]] = {}
    for c in convs:
        key = c.person_id or f"conv:{c.session_id}"
        if key not in by_key:
            order.append(key)
            by_key[key] = []
        by_key[key].append(c)
    out: list[Group] = []
    for key in order:
        members = tuple(by_key[key])
        pid = members[0].person_id
        kind = kinds.get(pid or "")
        slug, label = _topic(members)
        out.append(Group(key=key, person_id=pid, name=names.get(pid, pid) if pid else None,
                         relationship=kind if kind and kind != "unknown" else None, convs=members,
                         topic_id=slug, topic_label=label))
    return out


def whole_day(convs: Sequence[Conversation]) -> Group:
    """Every conversation of the day as one unnamed group (for goals without a person)."""
    slug, label = _topic(convs)
    return Group(key="day", person_id=None, name=None, relationship=None, convs=tuple(convs),
                 topic_id=slug, topic_label=label)


def hedge_counts(convs: Sequence[Conversation]) -> dict[str, int]:
    """Hedge phrases in the wearer's words, longest first and without double counting."""
    text = " ".join(ln.text for c in convs for ln in c.lines if ln.speaker == "me")
    text = f" {text.lower().replace(chr(0x2019), chr(39))} "
    out: dict[str, int] = {}
    for phrase in sorted(HEDGE_PHRASES, key=len, reverse=True):
        pattern = re.compile(rf"(?<![\w']){re.escape(phrase.lower())}(?![\w'])")
        n = len(pattern.findall(text))
        if n:
            out[phrase] = n
            text = pattern.sub(" ", text)
    return out


def _per_conv(g: Group, metric: str) -> float | None:
    return measure(g.convs, metric)


def _interrupt(g: Group) -> Reading:
    value = _per_conv(g, "interruptions")
    if value is None or g.other_lines < MIN_OTHER_LINES:
        return Reading("interrupt", value, None)
    if value >= INTERRUPT_BAD:
        return Reading("interrupt", value, "bad", value / INTERRUPT_BAD)
    if value == 0:
        return Reading("interrupt", value, "good", 1.5 + min(g.other_lines, 10) / 20)
    return Reading("interrupt", value, "ok")


def _share(g: Group, key: MeasureKey) -> Reading:
    value = _per_conv(g, "talk_ratio")
    if value is None:
        return Reading(key, value, None)
    if key == "share_high":
        if value >= SHARE_HIGH_BAD:
            return Reading(key, value, "bad", value / SHARE_HIGH_BAD)
        if SHARE_GOOD[0] <= value <= SHARE_GOOD[1] and g.together_min >= MIN_TOGETHER_MIN:
            return Reading(key, value, "good", 1.2)
        return Reading(key, value, "ok")
    per_conv_min = g.together_min / len(g.convs)
    if per_conv_min < MIN_TOGETHER_MIN:
        return Reading(key, value, None)
    if value <= SHARE_LOW_BAD:
        return Reading(key, value, "bad", SHARE_LOW_BAD / max(value, 0.05))
    return Reading(key, value, "ok")


def _questions(g: Group) -> Reading:
    value = _per_conv(g, "questions")
    if value is None or g.together_min / len(g.convs) < MIN_TOGETHER_MIN:
        return Reading("questions", value, None)
    if value == 0:
        return Reading("questions", value, "bad", 1.4)
    if value >= QUESTIONS_GOOD:
        return Reading("questions", value, "good", 1.0 + value / 10)
    return Reading("questions", value, "ok")


def _pace(g: Group) -> Reading:
    value = _per_conv(g, "wpm")
    if value is None or g.spoken_min < MIN_PACE_SPOKEN_MIN:
        return Reading("pace", value, None)
    if value >= PACE_BAD:
        return Reading("pace", value, "bad", value / PACE_BAD + 0.1)
    if PACE_GOOD[0] <= value <= PACE_GOOD[1]:
        return Reading("pace", value, "good", 1.0)
    return Reading("pace", value, "ok")


def _fillers(g: Group) -> Reading:
    value = _per_conv(g, "fillers_per_min")
    if value is None or g.spoken_min < MIN_FILLER_SPOKEN_MIN:
        return Reading("fillers", value, None)
    if value >= FILLERS_BAD:
        return Reading("fillers", value, "bad", value / FILLERS_BAD)
    if value <= FILLERS_GOOD:
        return Reading("fillers", value, "good", 1.0 + (FILLERS_GOOD - value) / 3)
    return Reading("fillers", value, "ok")


def _hedges(g: Group) -> Reading:
    counts = hedge_counts(g.convs)
    total = sum(counts.values())
    if g.spoken_min < MIN_FILLER_SPOKEN_MIN:
        return Reading("hedges", float(total), None)
    rate = total / g.spoken_min
    if total >= HEDGES_BAD_MIN_COUNT and rate >= HEDGES_BAD_PER_MIN:
        top = max(counts.items(), key=lambda kv: (kv[1], len(kv[0])))[0]
        return Reading("hedges", float(total), "bad", rate / HEDGES_BAD_PER_MIN, phrase=top)
    return Reading("hedges", float(total), "ok")


def read(g: Group, key: MeasureKey) -> Reading:
    """One measure's verdict for a group; None verdict when the group has too little speech."""
    if not g.has_evidence:
        return Reading(key, None, None)
    if key == "interrupt":
        return _interrupt(g)
    if key in ("share_high", "share_low"):
        return _share(g, key)
    if key == "questions":
        return _questions(g)
    if key == "pace":
        return _pace(g)
    if key == "fillers":
        return _fillers(g)
    return _hedges(g)


def readings(g: Group) -> list[Reading]:
    return [read(g, key) for key in MEASURES]
