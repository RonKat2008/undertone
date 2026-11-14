"""Judge: one verdict per wearer turn (plan.md 3.3, 4.3).

FINAL PUBLIC INTERFACE (do not change signatures; add private modules inside backend/judge/):

    async def judge_turn(ctx: TurnContext, coach: CoachSpec) -> JudgeEvent
    def rule_judge(ctx: TurnContext, coach: CoachSpec) -> dict[str, JudgeAnswer]
    def format_input(ctx: TurnContext) -> str
    CORE_QUESTIONS (backend/judge/core_questions.py)

judge_turn must never raise and must return within ~800 ms: call the Gemini Decisions API with
CORE_QUESTIONS merged with coach.questions (coach keys win), and on timeout / error /
settings.use_rule_judge_only fall back to rule_judge with source "rules".

STUB: always uses the rule judge. The worker replaces judge_turn's body with the Decisions call.
Decisions answers map onto contract JudgeAnswers like this (verified against the live API):
    noul   -> NoulAnswer(p=a.noul, confidence=a.confidence)
    choice -> ChoiceAnswer(choice=a.choice, probabilities=a.probabilities, confidence=a.confidence)
    score  -> ScoreAnswer(score=a.score, max=len(criteria) - 1, confidence=a.confidence)  # 0-based
"""

from __future__ import annotations

import re
import time

from backend.contracts import (
    ChoiceAnswer, CoachSpec, JudgeAnswer, JudgeEvent, NoulAnswer, ScoreAnswer, TurnContext,
)
from backend.judge.core_questions import CORE_QUESTIONS

__all__ = ["CORE_QUESTIONS", "format_input", "judge_turn", "rule_judge"]

_HEDGES = re.compile(r"\b(i think maybe|i'?m not (totally |really )?sure|kind of|sort of|possibly|"
                     r"i guess|maybe|could be)\b", re.I)
_PROMISE = re.compile(r"\b(i'?ll|i will|i'?m going to)\s+(send|follow up|email|share|get back|call)\b", re.I)
_ACK = re.compile(r"\b(good point|you'?re right|that makes sense|thanks for|as you said|great question)\b", re.I)
_OPEN_Q = re.compile(r"\b(how|what|why|tell me|walk me)\b[^?]*\?", re.I)
_INTERRUPT_OVERLAP_S = 0.2


def _noul(p: float) -> NoulAnswer:
    p = min(0.99, max(0.01, p))
    return NoulAnswer(p=p, confidence=max(p, 1 - p))


def format_input(ctx: TurnContext) -> str:
    """The text block sent to the Decisions API as `input`."""
    lines: list[str] = []
    prev = ctx.prev_other_turn
    if prev is not None:
        lines.append(f"OTHER PERSON (previous turn, {prev.start:.1f}-{prev.end:.1f} s): {prev.text}")
    else:
        lines.append("OTHER PERSON (previous turn): none")
    t = ctx.turn
    lines.append(f"WEARER (turn being judged, {t.start:.1f}-{t.end:.1f} s): {t.text}")
    if prev is not None and t.start < prev.end:
        lines.append(f"OVERLAP: the wearer started {prev.end - t.start:.1f} s before the other person finished.")
    else:
        lines.append("OVERLAP: none")
    lines.append(f"MOTION: {ctx.motion_summary or 'unknown'}")
    return "\n".join(lines)


def rule_judge(ctx: TurnContext, coach: CoachSpec) -> dict[str, JudgeAnswer]:
    """Cheap regex/timing judge. Answers every core question; coach-specific keys are skipped."""
    t = ctx.turn
    text = t.text
    prev = ctx.prev_other_turn
    dur = max(0.1, t.end - t.start)
    overlap = prev is not None and (prev.end - t.start) > _INTERRUPT_OVERLAP_S
    cut_off = prev is not None and prev.text.rstrip().endswith(("—", "-", "..."))
    asked = "?" in text
    hedges = len(_HEDGES.findall(text))
    words = len(text.split())
    open_q = bool(_OPEN_Q.search(text))
    qtype = "none" if not asked else ("open" if open_q else "closed")
    probs = {k: (0.85 if k == qtype else 0.05) for k in ("open", "closed", "leading", "none")}
    nervous = hedges >= 2 or len(t.fillers) >= 4
    tone = "nervous" if nervous else "confident"
    tone_probs = {k: (0.6 if k == tone else 0.1) for k in ("confident", "nervous", "defensive", "warm", "flat")}
    clarity_level = max(0.0, min(4.0, 3.0 - len(t.fillers) * 0.3 - hedges * 0.3 - (1.0 if dur > 45 else 0.0)))
    return {
        "interrupted": _noul(0.9 if overlap else (0.6 if cut_off else 0.1)),
        "asked_question": _noul(0.8 if asked else 0.1),
        "question_type": ChoiceAnswer(choice=qtype, probabilities=probs, confidence=probs[qtype]),
        "answered_the_question": _noul(0.6),
        "hedging": _noul(min(0.95, 0.15 + 0.3 * hedges)),
        "rambling": _noul(0.85 if dur > 45 or words > 120 else (0.5 if dur > 25 else 0.1)),
        "acknowledged": _noul(0.8 if _ACK.search(text) else 0.2),
        "tone": ChoiceAnswer(choice=tone, probabilities=tone_probs, confidence=0.6),
        "clarity": ScoreAnswer(score=round(clarity_level, 2), max=4, confidence=0.4),
        "commitment_made": _noul(0.9 if _PROMISE.search(text) else 0.05),
    }


async def judge_turn(ctx: TurnContext, coach: CoachSpec) -> JudgeEvent:
    """Judge one wearer turn. Never raises. STUB: rule judge only."""
    t0 = time.perf_counter()
    results = rule_judge(ctx, coach)
    return JudgeEvent(
        turn_id=ctx.turn.turn_id,
        results=results,
        latency_ms=round((time.perf_counter() - t0) * 1000, 1),
        source="rules",
    )
