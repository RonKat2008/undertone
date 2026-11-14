"""Locally computed debrief parts, the draft -> Debrief merge, and the no-LLM fallback."""

from __future__ import annotations

import re
from difflib import SequenceMatcher

from backend.contracts import (
    BetterVersion, BookmarkEvent, BookmarkReview, Debrief, DebriefNumbers, Metrics, SessionSummary,
    TimelinePoint, TurnFinalEvent,
)
from backend.debrief import rules
from backend.debrief.wire import BookmarkNote, DebriefDraft
from backend.state import SessionState

TURN_SLACK_S = 1.0          # a bookmark this close to a turn's edges belongs to that turn
RECENT_TURN_S = 10.0        # else: the turn that ended within this long before the bookmark
REACTION_S = 1.5            # people press the bookmark a moment after what they want to mark
SHORT_SNIPPET_CHARS = 80    # below this, add the neighbouring sentence
MAX_NOTES = 6
DEFAULT_WHAT_HAPPENED = "You marked this moment."


def numbers(metrics: Metrics) -> DebriefNumbers:
    return DebriefNumbers(
        talk_ratio=round(metrics.talk_ratio, 2), interruptions=metrics.interruptions,
        questions=metrics.questions, fillers_per_min=round(metrics.fillers_per_min, 1),
        wpm=float(round(metrics.wpm)),
    )


# ---------- bookmark snippets ----------
def _gap(turn: TurnFinalEvent, ts: float) -> float:
    return max(turn.start - ts, ts - turn.end, 0.0)


def _turn_at(session: SessionState, ts: float) -> TurnFinalEvent | None:
    if not session.turns:
        return None
    inside = [t for t in session.turns if t.start - TURN_SLACK_S <= ts <= t.end + TURN_SLACK_S]
    if inside:
        return min(inside, key=lambda t: (_gap(t, ts), -t.start))
    before = [t for t in session.turns if t.end < ts <= t.end + RECENT_TURN_S]
    if before:
        return max(before, key=lambda t: t.end)
    return min(session.turns, key=lambda t: _gap(t, ts))


def _trim(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    cut = text[: max_chars + 1].rsplit(" ", 1)[0] if " " in text[:max_chars + 1] else text[:max_chars]
    return cut[:max_chars].rstrip(" ,;:")


def bookmark_snippet(session: SessionState, ts: float, max_chars: int = 240) -> str:
    turn = _turn_at(session, ts)
    if turn is None:
        return ""
    text = " ".join(turn.text.split())
    if len(text) <= max_chars:
        return text
    sents = rules.sentences(text)
    span = turn.end - turn.start
    frac = min(max((ts - REACTION_S - turn.start) / span, 0.0), 1.0) if span > 0 else 0.0
    target = int(frac * len(text.split()))
    idx, seen = len(sents) - 1, 0
    for i, s in enumerate(sents):
        seen += len(s.split())
        if target < seen:
            idx = i
            break
    snippet = sents[idx]
    if len(snippet) < SHORT_SNIPPET_CHARS:
        if idx + 1 < len(sents) and len(snippet) + 1 + len(sents[idx + 1]) <= max_chars:
            snippet = f"{snippet} {sents[idx + 1]}"
        elif idx > 0 and len(snippet) + 1 + len(sents[idx - 1]) <= max_chars:
            snippet = f"{sents[idx - 1]} {snippet}"
    return _trim(snippet, max_chars)


# ---------- focus ----------
def focus_label(session: SessionState) -> str:
    """Readable focus habit: the rule id in words ("long_answer" -> "long answer").

    Falls back to the rule's message when the id is not word-like (e.g. "rule_7").
    """
    rid = session.policy.focus_rule_id
    readable = rid.replace("_", " ").replace("-", " ").strip()
    if readable and not re.search(r"\d", readable):
        return readable
    for rule in [*session.coach.nudge_rules, *session.coach.motion_rules]:
        if rule.id == rid and rule.message.strip():
            return rule.message.strip()
    return readable


# ---------- assemble ----------
def _review(event: BookmarkEvent, note: BookmarkNote | None, session: SessionState) -> BookmarkReview:
    fallback_follow = event.text if event.source == "promise" else None
    what = (note.what_happened.strip() if note else "") or event.text or DEFAULT_WHAT_HAPPENED
    follow = note.follow_up if note and note.follow_up and note.follow_up.strip() else fallback_follow
    return BookmarkReview(ts=event.ts, source=event.source, snippet=bookmark_snippet(session, event.ts),
                          what_happened=what, follow_up=follow)


def _reviews(session: SessionState, notes: list[BookmarkNote]) -> list[BookmarkReview]:
    by_index = {n.index: n for n in notes}
    return [_review(b, by_index.get(i), session) for i, b in enumerate(session.bookmarks)]


def _coverage(quote: str, text: str) -> float:
    q, t = rules.normalize(quote).split(), rules.normalize(text).split()
    if not q:
        return 0.0
    matched = sum(b.size for b in SequenceMatcher(None, q, t, autojunk=False).get_matching_blocks())
    return matched / len(q)


def _real_original(original: str, wearer: list[str]) -> str:
    stripped = original.strip(' "\'“”‘’')
    norm = rules.normalize(stripped)
    if norm and any(f" {norm} " in f" {rules.normalize(t)} " for t in wearer):
        return stripped
    return max(wearer, key=lambda t: (_coverage(stripped, t), rules.similarity(stripped, t)))


def assemble(draft: DebriefDraft, session: SessionState, metrics: Metrics, timeline: list[TimelinePoint],
             last: SessionSummary | None) -> Debrief:
    wearer = rules.wearer_texts(session)
    better: BetterVersion | None = None
    if draft.better_version is not None and wearer:
        better = BetterVersion(original=_real_original(draft.better_version.original, wearer),
                               rewritten=draft.better_version.rewritten.strip(), audio_url=None)
    return Debrief(
        headline_fact=draft.headline_fact.strip(), strength=draft.strength.strip(),
        one_fix=draft.one_fix.strip(), if_then=draft.if_then.strip(),
        numbers=numbers(metrics),
        best_moment_quote=rules.verify_quote(draft.best_moment_quote, wearer),
        vs_last_time=(draft.vs_last_time or "").strip() or None if last is not None else None,
        notes=[n.strip() for n in draft.notes if n.strip()][:MAX_NOTES],
        bookmarks=_reviews(session, draft.bookmarks),
        timeline=list(timeline),
        better_version=better,
    )


# ---------- fallback ----------
IF_THEN: dict[str, str] = {
    "hedging": 'When you catch yourself saying "I think maybe", stop and state your answer in one sentence.',
    "fillers": "When you feel a filler coming, pause for one breath instead.",
    "long_answer": "When you hit 30 seconds, land the result in one sentence and stop.",
    "long_turn": "When you hit 30 seconds, hand it back with a question.",
    "talk": "When you finish a point, ask them one open question before adding more.",
    "interrupt": "When they pause mid-sentence, count to two before you speak.",
    "question": "If two minutes pass without a question from you, ask one about their last point.",
    "pace": "When you start a new point, take one breath and slow your first sentence.",
}
DEFAULT_IF_THEN = "When you hit 30 seconds, end with a question."
GOALS: dict[str, str] = {
    "hedging": "direct answers with no hedges", "fillers": "pauses instead of fillers",
    "long_answer": "answers that land the result", "long_turn": "short turns",
}
_ALIASES: tuple[tuple[str, str], ...] = (
    ("hedg", "hedging"), ("filler", "fillers"), ("long_answer", "long_answer"), ("long_turn", "long_turn"),
    ("interrupt", "interrupt"), ("talk", "talk"), ("question", "question"), ("ask", "question"),
    ("pace", "pace"), ("answer", "long_answer"), ("result", "long_answer"), ("number", "long_answer"),
)
ANSWER_GROUP = frozenset({"hedging", "fillers", "long_answer", "long_turn"})
STRENGTH_QUOTE_WORDS = 20
SHORT_TURN_WORDS = 15


def _focus_key(session: SessionState) -> str:
    rid = session.policy.focus_rule_id.lower()
    return next((key for needle, key in _ALIASES if needle in rid), "")


def _plural(n: float, word: str) -> str:
    return f"{n:g} {word}{'' if n == 1 else 's'}"


def _secs(turn: TurnFinalEvent) -> int:
    return round(turn.end - turn.start)


def _quote(text: str, max_words: int) -> str:
    words = text.split()
    return " ".join(words[:max_words]) if len(words) > max_words else text


def _headline(key: str, me: list[TurnFinalEvent], metrics: Metrics) -> str:
    pct = round(metrics.talk_ratio * 100)
    if key in ANSWER_GROUP and me:
        longest = max(me, key=_secs)
        goal = GOALS.get(key, "direct answers")
        return (f"Your longest answer ran {_secs(longest)} seconds with "
                f"{_plural(len(longest.fillers), 'filler')}; the goal was {goal}.")
    if key == "pace" and me:
        base = f" against your usual {round(metrics.baseline_wpm)}" if metrics.baseline_wpm else ""
        return f"You averaged {round(metrics.wpm)} words per minute{base}."
    if key == "interrupt":
        return f"You interrupted {_plural(metrics.interruptions, 'time')} and talked {pct}% of the time."
    return f"You talked {pct}% of the time and asked {_plural(metrics.questions, 'question')}."


def _strength_turn(me: list[TurnFinalEvent]) -> TurnFinalEvent | None:
    clean = [t for t in me if not t.fillers and ("?" in t.text or len(t.text.split()) < SHORT_TURN_WORDS)]
    if clean:
        return min(clean, key=lambda t: len(t.text.split()))
    return min(me, key=lambda t: (len(t.fillers) / max(1, len(t.text.split())), -len(t.text)), default=None)


def _strength(turn: TurnFinalEvent | None, session: SessionState) -> str:
    if turn is None:
        others = sum(1 for t in session.turns if t.speaker == "other")
        if others:
            return f"You let the other person speak for all {_plural(others, 'turn')} without cutting in."
        return f"You started a session and recorded {round(session.duration_s)} seconds."
    if not turn.fillers:
        return f'You said "{_quote(turn.text, STRENGTH_QUOTE_WORDS)}"'
    return (f"Your cleanest turn had {_plural(len(turn.fillers), 'filler')} in "
            f'{len(turn.text.split())} words: "{_quote(turn.text, 12)}"')


def _one_fix(key: str, me: list[TurnFinalEvent], metrics: Metrics) -> str:
    if not me:
        return "You did not take a turn, so the other person carried the whole conversation."
    if key == "interrupt" and metrics.interruptions:
        return f"You started speaking before the other person finished, {_plural(metrics.interruptions, 'time')}."
    if key in ("talk", "question") and metrics.questions == 0:
        return f"You took {_plural(len(me), 'turn')} without asking a question."
    longest = max(me, key=_secs)
    if key in ANSWER_GROUP and longest.fillers:
        ending = (rules.sentences(longest.text) or [longest.text])[-1]
        words = ending.split()[:14]
        cut = max((i for i, w in enumerate(words[:-1]) if w.endswith(",")), default=len(words) - 1)
        clause = " ".join(words[: cut + 1]).rstrip(",.")
        return f'Your longest answer ended on "{clause}" instead of one clear point.'
    return f"Your longest turn ran {_secs(longest)} seconds before you handed the conversation back."


def _vs_last(metrics: Metrics, last: SessionSummary | None) -> str | None:
    if last is None:
        return None
    prev = last.numbers
    return (f"Fillers went from {prev.fillers_per_min:.1f} to {metrics.fillers_per_min:.1f} per minute since "
            f"your last session; talk time went from {round(prev.talk_ratio * 100)}% to "
            f"{round(metrics.talk_ratio * 100)}%.")


def _notes(session: SessionState, me: list[TurnFinalEvent], metrics: Metrics) -> list[str]:
    duration = round(session.duration_s)
    others = len(session.turns) - len(me)
    fillers = sum(len(t.fillers) for t in me)
    notes = [f"{_plural(len(me), 'turn')} from you and {others} from the other person over {duration} seconds."
             if session.turns else f"No turns were recorded over {duration} seconds.",
             f"You asked {_plural(metrics.questions, 'question')} and used {_plural(fillers, 'filler')} "
             f"({metrics.fillers_per_min:.1f} per minute)."]
    if session.bookmarks:
        notes.append(f"You marked {_plural(len(session.bookmarks), 'moment')} to review.")
    promises = [b.text for b in session.bookmarks if b.source == "promise" and b.text]
    if promises:
        notes.append(f"Follow-up: {promises[0]}")
    return notes[:4]


def fallback_draft(session: SessionState, metrics: Metrics, last: SessionSummary | None) -> DebriefDraft:
    me = [t for t in session.turns if t.speaker == "me"]
    key = _focus_key(session)
    turn = _strength_turn(me)
    return DebriefDraft(
        headline_fact=_headline(key, me, metrics), strength=_strength(turn, session),
        one_fix=_one_fix(key, me, metrics), if_then=IF_THEN.get(key, DEFAULT_IF_THEN),
        best_moment_quote=turn.text if turn else "", vs_last_time=_vs_last(metrics, last),
        notes=_notes(session, me, metrics),
    )


def fallback_debrief(session: SessionState, metrics: Metrics, timeline: list[TimelinePoint],
                     last: SessionSummary | None) -> Debrief:
    """Deterministic, rule-compliant debrief built from metrics and the focus habit (no LLM)."""
    return assemble(fallback_draft(session, metrics, last), session, metrics, timeline, last)
