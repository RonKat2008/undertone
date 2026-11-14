"""Habit profile (plan.md 4.9): baselines, crutch words and recurring issues from stored sessions.

Pure functions over StoredSession lists hold the maths; `rebuild_profile` is the thin DB wrapper.
Everything compares the wearer only with their own past.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterable, Sequence
from functools import lru_cache
from statistics import median
from typing import Literal

from pydantic import ValidationError

from backend.contracts import CrutchWord, HabitProfile, RecurringIssue
from backend.db import DB
from backend.growth._store import StoredSession, load_sessions, rule_label

log = logging.getLogger(__name__)

BUILTIN_FILLERS: tuple[str, ...] = (
    "like", "um", "uh", "basically", "you know", "sort of", "kind of", "i mean", "actually",
    "literally", "honestly", "so yeah", "anyway",
)

TOP_CRUTCH_WORDS = 5
TREND_WINDOW = 3  # last 3 sessions vs the 3 before
TREND_MIN_RELATIVE = 0.15  # a change must be at least 15% ...
TREND_MIN_ABSOLUTE = 0.5  # ... and at least half a fire per session to count

# Words that, right before "like", make it a verb or a comparison rather than a filler.
_LIKE_NOT_FILLER = frozenset({
    "i", "you", "we", "they", "he", "she", "would", "i'd", "you'd", "we'd", "they'd", "he'd", "she'd",
    "look", "looks", "looked", "looking", "sound", "sounds", "sounded", "seem", "seems", "seemed",
    "feel", "feels", "felt", "feeling", "just", "do", "does", "did", "don't", "doesn't", "didn't",
    "something", "anything", "nothing", "really", "much", "more", "most",
})
# Words that, right before "kind of" / "sort of", make it a noun phrase ("a kind of car").
_KIND_NOT_FILLER = frozenset({"a", "the", "what", "this", "that", "some", "any", "same", "every", "which"})
_EXCLUSIONS: dict[str, frozenset[str]] = {
    "like": _LIKE_NOT_FILLER, "kind of": _KIND_NOT_FILLER, "sort of": _KIND_NOT_FILLER,
}
_PREV_WORD = re.compile(r"([\w']+)[^\w']*$")

Trend = Literal["better", "same", "worse"]


def _normalise(words: Iterable[str]) -> tuple[str, ...]:
    cleaned = {" ".join(w.lower().replace("’", "'").split()) for w in words}
    return tuple(sorted((w for w in cleaned if w), key=lambda w: (-len(w), w)))


@lru_cache(maxsize=64)
def _pattern(words: tuple[str, ...]) -> re.Pattern[str]:
    alternatives = "|".join(r"\s+".join(re.escape(part) for part in w.split()) for w in words)
    return re.compile(rf"(?<![\w'])(?:{alternatives})(?![\w'])")


def _is_excluded(phrase: str, before: str) -> bool:
    blocked = _EXCLUSIONS.get(phrase)
    if blocked is None:
        return False
    prev = _PREV_WORD.search(before)
    return prev is not None and prev.group(1) in blocked


def count_fillers(text: str, words: Iterable[str]) -> dict[str, int]:
    """Case-insensitive, whole-word filler counts; longer phrases win; keys are lower-case."""
    phrases = _normalise(words)
    lowered = text.lower().replace("’", "'")
    if not phrases or not lowered.strip():
        return {}
    counts: dict[str, int] = {}
    for match in _pattern(phrases).finditer(lowered):
        phrase = " ".join(match.group(0).split())
        if _is_excluded(phrase, lowered[:match.start()]):
            continue
        counts = {**counts, phrase: counts.get(phrase, 0) + 1}
    return counts


def _median_or_none(values: Iterable[float]) -> float | None:
    data = [v for v in values if v]
    return round(float(median(data)), 2) if data else None


def _crutch_words(sessions: Sequence[StoredSession], words: tuple[str, ...]) -> list[CrutchWord]:
    totals: dict[str, int] = {}
    for session in sessions:
        for turn in session.wearer_turns:
            for word, n in count_fillers(turn.text, words).items():
                totals = {**totals, word: totals.get(word, 0) + n}
    minutes = sum(s.minutes for s in sessions)
    if minutes <= 0:
        return []
    ranked = sorted(((w, round(n / minutes, 2)) for w, n in totals.items()), key=lambda p: (-p[1], p[0]))
    return [CrutchWord(word=w, per_min=r) for w, r in ranked if r > 0][:TOP_CRUTCH_WORDS]


def _mean_fires(sessions: Sequence[StoredSession], rule_id: str) -> float:
    return sum(s.fired(rule_id) for s in sessions) / len(sessions) if sessions else 0.0


def _trend(sessions: Sequence[StoredSession], rule_id: str) -> Trend:
    """Newest-first sessions: the last 3 vs the 3 before (or each half of what is there)."""
    window = list(sessions[: TREND_WINDOW * 2])
    if len(window) < 2:
        return "same"
    split = TREND_WINDOW if len(window) == TREND_WINDOW * 2 else len(window) // 2
    recent, prior = _mean_fires(window[:split], rule_id), _mean_fires(window[split:], rule_id)
    margin = max(TREND_MIN_RELATIVE * max(recent, prior), TREND_MIN_ABSOLUTE)
    if prior - recent >= margin:
        return "better"
    if recent - prior >= margin:
        return "worse"
    return "same"


def _recurring_issues(sessions: Sequence[StoredSession]) -> list[RecurringIssue]:
    rule_ids = sorted({n.rule_id for s in sessions for n in s.nudges})
    issues = [RecurringIssue(rule_id=r, label=rule_label(r), rate=round(_mean_fires(sessions, r), 2),
                             trend=_trend(sessions, r)) for r in rule_ids]
    return sorted(issues, key=lambda i: (-i.rate, i.rule_id))


def compute_profile(sessions: Sequence[StoredSession], filler_words: Iterable[str] = ()) -> HabitProfile:
    """Pure: sessions newest first (as load_sessions returns)."""
    words = _normalise((*BUILTIN_FILLERS, *filler_words))
    return HabitProfile(
        sessions=len(sessions),
        baseline_wpm=_median_or_none(s.numbers.wpm for s in sessions),
        baseline_volume_db=_median_or_none(s.metrics.volume_db for s in sessions if s.metrics is not None),
        crutch_words=_crutch_words(sessions, words),
        recurring_issues=_recurring_issues(sessions),
    )


def coach_filler_words(db: DB) -> tuple[str, ...]:
    """Filler words from every saved coach; an unreadable coach row is logged and skipped."""
    try:
        coaches = db.list_coaches()
    except ValidationError:
        log.warning("could not read coaches for filler words; using built-ins only")
        return ()
    return tuple(w for c in coaches for w in c.filler_words)


def rebuild_profile(db: DB, filler_words: Iterable[str] = ()) -> HabitProfile:
    profile = compute_profile(load_sessions(db), (*filler_words, *coach_filler_words(db)))
    db.save_profile(profile)
    return profile
