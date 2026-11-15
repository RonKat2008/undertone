"""Rule-judge answers for a few coach-specific questions (private).

Keyed by question id and type: a coach that defines the same id with another type gets the
neutral answer instead. Used by judge/rules.py when the Decisions API is unavailable.
"""

from __future__ import annotations

from collections.abc import Callable

from backend.contracts import ChoiceAnswer, JudgeAnswer, NoulAnswer, TurnContext
from backend.judge import _rule_patterns as rx

STRATEGIES = ("paraphrase", "example", "asked_to_clarify", "none")
_YES_P = 0.9
_ECHO_P = 0.82
_NO_P = 0.06


def _noul(p: float) -> NoulAnswer:
    return NoulAnswer(p=p, confidence=round(max(p, 1 - p), 3))


# "And then?", "Really?", "Next?" ask the wearer to go on; repeating these words is not an echo.
_CONTINUATION_WORDS = frozenset(
    "then next after really okay ok right yeah yes no oh huh what else more go on".split()
)


def _content_words(text: str) -> set[str]:
    return {w.lower() for w in rx.words(text)
            if w.lower() not in rx.STOPWORDS and w.lower() not in _CONTINUATION_WORDS}


def _already_answered(ctx: TurnContext) -> bool:
    """A wearer turn after the other person's previous turn already replied to it."""
    prev = ctx.prev_other_turn
    return prev is not None and any(
        t.speaker == "me" and t.start >= prev.start and t.turn_id != ctx.turn.turn_id
        for t in ctx.recent_turns
    )


def _wearer_before(ctx: TurnContext) -> str | None:
    """The wearer's turn just before the other person's previous turn, if any."""
    prev = ctx.prev_other_turn
    if prev is None:
        return None
    earlier = [t for t in ctx.recent_turns if t.speaker == "me" and t.end <= prev.start + 0.5]
    return earlier[-1].text if earlier else None


def _is_echo(other: str, wearer_before: str | None) -> bool:
    """A short questioning fragment that repeats the wearer's own words ('Assist the meeting?')."""
    if not wearer_before or not other.rstrip().endswith("?") or rx.STARTS_NEW_QUESTION.search(other):
        return False
    if len(rx.words(other)) > rx.REPAIR_ECHO_MAX_WORDS:
        return False
    echoed = _content_words(other)
    return bool(echoed) and echoed <= _content_words(wearer_before)


def repair_request(ctx: TurnContext) -> NoulAnswer:
    prev = ctx.prev_other_turn
    if prev is None:
        return _noul(0.03)
    if _already_answered(ctx):
        return _noul(_NO_P)
    text = prev.text.strip()
    if rx.REPAIR_BARE.match(text) or rx.REPAIR_PHRASE.search(text):
        return _noul(_YES_P)
    return _noul(_ECHO_P if _is_echo(text, _wearer_before(ctx)) else _NO_P)


def checked_understanding(ctx: TurnContext) -> NoulAnswer:
    return _noul(_YES_P if rx.CHECK_IN.search(ctx.turn.text) else _NO_P)


def self_deprecation(ctx: TurnContext) -> NoulAnswer:
    return _noul(_YES_P if rx.SELF_DEPRECATION.search(ctx.turn.text) else _NO_P)


def strategy_used(ctx: TurnContext) -> ChoiceAnswer:
    text = ctx.turn.text
    found = next((name for name, pattern in (("asked_to_clarify", rx.ASKED_TO_CLARIFY),
                                             ("paraphrase", rx.PARAPHRASE), ("example", rx.EXAMPLE))
                  if pattern.search(text)), "none")
    top = 0.75 if found != "none" else 0.7
    rest = round((1.0 - top) / (len(STRATEGIES) - 1), 4)
    probs = {s: (round(1.0 - rest * (len(STRATEGIES) - 1), 4) if s == found else rest) for s in STRATEGIES}
    return ChoiceAnswer(choice=found, probabilities=probs, confidence=probs[found])


# question id -> (question type it answers, answer function)
COACH_RULES: dict[str, tuple[str, Callable[[TurnContext], JudgeAnswer]]] = {
    "repair_request": ("noul", repair_request),
    "checked_understanding": ("noul", checked_understanding),
    "self_deprecation": ("noul", self_deprecation),
    "strategy_used": ("choice", strategy_used),
}
