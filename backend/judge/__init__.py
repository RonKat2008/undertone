"""Judge: one verdict per wearer turn (plan.md 3.3, 4.3).

PUBLIC INTERFACE:

    async def judge_turn(ctx: TurnContext, coach: CoachSpec) -> JudgeEvent
    def rule_judge(ctx: TurnContext, coach: CoachSpec) -> dict[str, JudgeAnswer]   (judge/rules.py)
    def format_input(ctx: TurnContext) -> str
    async def warm_up() -> bool                                                     (judge/decisions.py)
    CORE_QUESTIONS                                                                  (judge/core_questions.py)

judge_turn never raises and returns within ~850 ms. It makes ONE Gemini Decisions call
(judge/decisions.py) with CORE_QUESTIONS merged with coach.questions (coach keys win) under an
800 ms deadline. On no key / settings.use_rule_judge_only / timeout / API error it returns the
rule judge with source "rules". On success, question ids the Decisions response left out are
filled from the rule judge (source stays "decisions").

Answer mapping (wire contract):
    noul   -> NoulAnswer(p in [0.01, 0.99], confidence)
    choice -> ChoiceAnswer(choice, probabilities, confidence)
    score  -> ScoreAnswer(score, max=len(criteria), confidence) -- score is 1-BASED: 1..max
              (Decisions returns a 0-based level; we add 1).

Brain should call `asyncio.create_task(judge.warm_up())` at session start so the first real
turn does not pay the cold TLS/connection cost (~500-870 ms cold vs ~230 ms warm).
"""

from __future__ import annotations

import logging
import time

from backend import config
from backend.contracts import CoachSpec, JudgeAnswer, JudgeEvent, TurnContext
from backend.judge import decisions
from backend.judge.core_questions import CORE_QUESTIONS
from backend.judge.decisions import warm_up
from backend.judge.rules import rule_judge

__all__ = ["CORE_QUESTIONS", "format_input", "judge_turn", "rule_judge", "warm_up"]

log = logging.getLogger("undertone.judge")

_IMMEDIATE_GAP_S = 0.15


def _timing_line(gap_s: float) -> str:
    """gap_s = wearer start - other person's end (negative means overlap)."""
    if gap_s < 0 and -gap_s >= _IMMEDIATE_GAP_S:
        return f"TIMING: the wearer started {-gap_s:.1f} s before the other person finished."
    if abs(gap_s) < _IMMEDIATE_GAP_S:
        return "TIMING: the wearer started immediately as the other person stopped."
    return f"TIMING: the wearer started {gap_s:.1f} s after the other person finished."


def format_input(ctx: TurnContext) -> str:
    """The text block sent to the Decisions API as `input`."""
    prev = ctx.prev_other_turn
    lines: list[str] = []
    if prev is not None:
        lines.append(f"OTHER PERSON (previous turn): {prev.text}")
    else:
        lines.append("OTHER PERSON (previous turn): none — the wearer is speaking first")
    lines.append(f"WEARER (turn being judged): {ctx.turn.text}")
    if prev is not None:
        lines.append(_timing_line(ctx.turn.start - prev.end))
    lines.append(f"MOTION: {ctx.motion_summary or 'unknown'}")
    return "\n".join(lines)


def _event(ctx: TurnContext, results: dict[str, JudgeAnswer], t0: float, source: str) -> JudgeEvent:
    return JudgeEvent(
        turn_id=ctx.turn.turn_id,
        results=results,
        latency_ms=round((time.perf_counter() - t0) * 1000, 1),
        source=source,  # type: ignore[arg-type]
    )


def _safe_rules(ctx: TurnContext, coach: CoachSpec) -> dict[str, JudgeAnswer]:
    try:
        return rule_judge(ctx, coach)
    except Exception:  # noqa: BLE001 - judge_turn must never raise
        log.exception("rule judge raised on %s", ctx.turn.turn_id)
        return {}


async def judge_turn(ctx: TurnContext, coach: CoachSpec) -> JudgeEvent:
    """Judge one wearer turn. Never raises."""
    t0 = time.perf_counter()
    settings = config.settings
    if settings.use_rule_judge_only or not settings.has_gemini:
        return _event(ctx, _safe_rules(ctx, coach), t0, "rules")
    try:
        answers = await decisions.decide(format_input(ctx), decisions.merge_questions(coach))
    except Exception as exc:  # noqa: BLE001 - DecisionsUnavailable or anything unexpected
        log.warning("decisions judge unavailable on %s (%s); using rules", ctx.turn.turn_id, exc)
        return _event(ctx, _safe_rules(ctx, coach), t0, "rules")
    rules = _safe_rules(ctx, coach)
    merged = {**{k: v for k, v in rules.items() if k not in answers}, **answers}
    return _event(ctx, merged, t0, "decisions")
