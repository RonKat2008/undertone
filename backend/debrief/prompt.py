"""Prompt for the debrief LLM call (plan.md 4.0 and 4.6).

The model writes language only; numbers, timeline and bookmark snippets are computed
locally (`local.py`). The prompt hands it the facts it may cite and the wording rules.
"""

from __future__ import annotations

import re

from backend.contracts import (
    ChoiceAnswer, JudgeEvent, Metrics, NoulAnswer, ScoreAnswer, SessionSummary, TurnFinalEvent,
)
from backend.debrief.local import bookmark_snippet, focus_label
from backend.state import SessionState

NOTABLE_P = 0.7          # yes/no judge answers at or above this are worth showing
NOTABLE_SCORE_SHARE = 0.5  # score answers at or below this share of max are worth showing
SNIPPET_CHARS = 200
HEDGE_PHRASES: tuple[str, ...] = (
    "I think maybe", "I'm not totally sure", "I'm not sure", "could possibly", "I guess", "probably",
    "kind of", "sort of", "maybe", "I think",
)

RULES = """RULES (follow every one; answers that break them are rejected):
- Plain, warm, second person ("you"). No markdown, no bullet symbols, no emoji.
- Describe what the wearer did, never what they are. Say "Your answer ran 49 seconds", never "you ramble", "you are indecisive", "you lack confidence".
- Compare only with the wearer's own past session. Never with other people, other candidates or "most people".
- Use only numbers from FACTS or the TRANSCRIPT header fields (turn seconds, filler counts). For hedges, cite the counted phrases in FACTS; never add counts together or invent a number.
- Never mention turn ids ("t04", "turn six"); refer to moments by what was said ("your framework answer").
- headline_fact: at most 20 words. The single most telling fact against the goal and the focus habit. It MUST contain an exact number from FACTS (for example a turn's seconds or a filler count) or an exact quote copied from the transcript in double quotes. Prefer both.
- strength: at most 18 words. One specific thing that actually happened, with a short quote in double quotes or a cited moment. Never generic praise such as "great job", "you did well", "good energy".
- one_fix: at most 18 words. Starts with "You" or "Your" and describes exactly one behaviour the wearer did in this conversation, ideally with a short quote. Not an instruction ("Drop...", "Try...") and not a trait.
- if_then: at most 16 words. Starts with "When" or "If", names a concrete cue the wearer will notice in the moment (a phrase they hear themselves say, a question being asked, a time mark), then one action. Example: "When you hear yourself say "I think maybe", stop and state your choice."
- best_moment_quote: one sentence copied word for word from a ME turn (the wearer's best line; prefer a full sentence of 5 or more words).
- vs_last_time: see LAST SESSION.
- notes: 3 to 5 short lines on what was discussed, decisions and any commitments.
- bookmarks: one entry per numbered bookmark, using its index. what_happened: one or two sentences. follow_up: the action for a promise; otherwise null unless a clear action exists.
- better_version: original = the wearer's weakest ME turn copied verbatim and whole; rewritten = the same answer tighter, answer first, in natural spoken first person with contractions ("I'd"), keeping the wearer's own facts, inventing nothing, under 60 words."""


def _turn_line(turn: TurnFinalEvent) -> str:
    who = "ME" if turn.speaker == "me" else "OTHER"
    dur = turn.end - turn.start
    extra = f", {len(turn.text.split())} words"
    if turn.speaker == "me":
        extra += f", {len(turn.fillers)} fillers"
    return f"{turn.turn_id} [{turn.start:.1f}s, {dur:.1f}s long{extra}] {who}: {turn.text}"


def _judge_line(event: JudgeEvent) -> str | None:
    parts: list[str] = []
    for qid, answer in event.results.items():
        if isinstance(answer, NoulAnswer) and answer.p >= NOTABLE_P:
            parts.append(f"{qid} p={answer.p:.2f}")
        elif isinstance(answer, ScoreAnswer) and answer.max > 0 and answer.score / answer.max <= NOTABLE_SCORE_SHARE:
            parts.append(f"{qid} {answer.score:g}/{answer.max:g}")
        elif isinstance(answer, ChoiceAnswer):
            parts.append(f"{qid} {answer.choice}")
    return f"{event.turn_id}: {', '.join(parts)}" if parts else None


def _share(count: int, total: int) -> str:
    return f"{count / total:.0%}" if total else "n/a"


def motion_summary(session: SessionState) -> str:
    """One line: fidget share while the other person spoke, gesture share while the wearer spoke."""
    listening = [m for m in session.motion if m.speaker_context == "other"]
    speaking = [m for m in session.motion if m.speaker_context == "me"]
    if not listening and not speaking:
        return "no motion data"
    fidget = sum(1 for m in listening if m.state == "fidget")
    gesture = sum(1 for m in speaking if m.state == "gesture")
    return (f"hands: fidgeting in {_share(fidget, len(listening))} of samples while the other person spoke; "
            f"gesturing in {_share(gesture, len(speaking))} of samples while you spoke")


def hedge_counts(session: SessionState) -> str:
    """Counts of common hedge phrases in the wearer's turns (overlapping: "maybe" includes "I think maybe")."""
    text = " ".join(t.text for t in session.turns if t.speaker == "me").lower().replace("\u2019", "'")
    counts = [(p, len(re.findall(rf"(?<![\w']){re.escape(p.lower())}(?![\w'])", text))) for p in HEDGE_PHRASES]
    found = [f'"{p}" x{n}' for p, n in counts if n]
    return ", ".join(found) if found else "none"


def _facts(metrics: Metrics, session: SessionState) -> str:
    lines = [
        f"talk ratio {metrics.talk_ratio:.0%} (share of speaking time that was the wearer)",
        f"questions asked by the wearer {metrics.questions}",
        f"interruptions {metrics.interruptions}",
        f"fillers per minute {metrics.fillers_per_min:g}",
        f"pace {metrics.wpm:g} words per minute",
        f"conversation length {session.duration_s:.0f} seconds",
    ]
    if metrics.baseline_wpm:
        lines.append(f"usual pace {metrics.baseline_wpm:g} words per minute")
    me = [t for t in session.turns if t.speaker == "me"]
    if me:
        longest = max(me, key=lambda t: t.end - t.start)
        lines.append(f"longest ME turn {longest.turn_id}: {longest.end - longest.start:.0f} seconds, "
                     f"{len(longest.fillers)} fillers")
    lines.append(f"hedge phrases in ME turns (counted in code; counts overlap): {hedge_counts(session)}")
    return "\n".join(f"- {line}" for line in lines)


def _last_block(last: SessionSummary | None) -> str:
    if last is None:
        return ("There is no past session. vs_last_time MUST be null. "
                "Do not mention last time or improvement over time anywhere.")
    n = last.numbers
    return (f"Past session ({last.coach_name}, {last.duration_s:.0f} s): talk ratio {n.talk_ratio:.0%}, "
            f"questions {n.questions}, interruptions {n.interruptions}, fillers per minute "
            f"{n.fillers_per_min:g}, pace {n.wpm:g} wpm. Its headline: {last.headline_fact}\n"
            "vs_last_time: one sentence, at most 25 words, comparing one or two of these numbers with "
            "this session's FACTS (the wearer's own past only).")


def _bookmark_block(session: SessionState) -> str:
    if not session.bookmarks:
        return "none (bookmarks must be an empty list)"
    lines = []
    for i, b in enumerate(session.bookmarks):
        label = f' "{b.text}"' if b.text else ""
        snippet = bookmark_snippet(session, b.ts, max_chars=SNIPPET_CHARS)
        lines.append(f"{i}. at {b.ts:.1f}s, source {b.source}{label}. Around it: {snippet}")
    return "\n".join(lines)


def _nudge_block(session: SessionState) -> str:
    lines = [f"- {n.rule_id} at {n.ts:.0f}s: {n.message}" for n in session.nudges]
    lines += [f"- signal {s.kind} at {s.ts:.0f}s: {s.detail}" for s in session.signals]
    return "\n".join(lines) if lines else "none"


def build_prompt(session: SessionState, metrics: Metrics, last: SessionSummary | None,
                 reasons: list[str] | None = None) -> str:
    """The full debrief prompt. `reasons` lists why a previous draft was rejected."""
    coach = session.coach
    judge_lines = [line for t in session.turns if t.speaker == "me" and t.turn_id in session.judge_results
                   if (line := _judge_line(session.judge_results[t.turn_id])) is not None]
    sections = [
        "You are Undertone, a speech coach writing the debrief after one conversation. "
        "ME is the wearer you are coaching; OTHER is the person they spoke with.",
        "ME and OTHER are transcript labels only. Never write them in your answer: address the wearer as "
        "\"you\" and call the other speaker \"them\" or \"the other person\" (or their name if it was said).",
        f"COACH: {coach.name}. Goal: {coach.goal}\nRubric: {coach.debrief_rubric}",
        f"FOCUS HABIT: {focus_label(session)} (rule id {session.policy.focus_rule_id}). "
        "The headline and the fix should be about this habit when the transcript supports it.",
        "TRANSCRIPT (turn id [start, length, words, fillers] speaker: text):\n"
        + "\n".join(_turn_line(t) for t in session.turns),
        "JUDGE NOTES on ME turns (p = probability 0-1; scores are out of the max):\n"
        + ("\n".join(judge_lines) or "none"),
        f"NUDGES AND SIGNALS during the conversation:\n{_nudge_block(session)}",
        f"BODY: {motion_summary(session)}",
        "FACTS (use only these numbers, or counts you can verify in the transcript):\n"
        + _facts(metrics, session),
        f"LAST SESSION: {_last_block(last)}",
        f"BOOKMARKS:\n{_bookmark_block(session)}",
        RULES,
    ]
    if reasons:
        sections.append("Your previous answer was rejected for:\n"
                        + "\n".join(f"- {r}" for r in reasons)
                        + "\nWrite a new answer that fixes every one of these and still follows all the rules.")
    return "\n\n".join(sections)
