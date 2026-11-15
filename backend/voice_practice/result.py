"""Answers -> PracticeResult: measure, score, judge, set goals, check last time's goals."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Sequence

from backend.contracts import CoachSpec, PracticeGoal, PracticeResult
from backend.voice_practice.goals import build_goals, check_previous
from backend.voice_practice.judge import judge
from backend.voice_practice.measure import AnswerRecord, measure_answer, totals
from backend.voice_practice.score import measured_scores, overall


@dataclass(frozen=True)
class SessionFacts:
    coach: CoachSpec
    started_at: str  # ISO 8601
    duration_s: float
    ended_early: bool
    previous_goals: tuple[PracticeGoal, ...] = ()


async def build_result(facts: SessionFacts, records: Sequence[AnswerRecord]) -> PracticeResult | None:
    """None when nothing was answered: no result is better than a made-up one."""
    answers = [measure_answer(r, facts.coach.filler_words) for r in records]
    answers = [a for a in answers if a.words > 0]
    if not answers:
        return None
    answers = [a.model_copy(update={"index": i}) for i, a in enumerate(answers, start=1)]
    t = totals(answers)
    measured = measured_scores(answers, t)
    verdict = await judge(facts.coach, answers, t, measured)
    scores = [verdict.structure, *measured]
    goals = build_goals(answers, t, scores, verdict.structure_goal)
    checks = check_previous(facts.previous_goals, answers, t, float(verdict.structure.score))
    return PracticeResult(
        id=uuid.uuid4().hex[:12], coach_id=facts.coach.id, coach_name=facts.coach.name,
        started_at=facts.started_at, duration_s=round(facts.duration_s, 1), overall=overall(scores),
        summary=verdict.summary, sub_scores=scores, strengths=verdict.strengths, goals=goals,
        previous_goals=checks, answers=answers, totals=t, judged_by=verdict.judged_by,
        ended_early=facts.ended_early,
    )
