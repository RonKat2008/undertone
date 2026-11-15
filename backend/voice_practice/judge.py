"""Content and structure judgement: Gemini (backend/llm.py) with a rule-based fallback.

Gemini judges only what numbers cannot: structure (a 0-100 score with a reason), the
strengths, one structure goal and the summary line. It is given the measured numbers so its
words agree with them, but it never sets a measured sub-score.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Sequence

from pydantic import BaseModel, Field

from backend.contracts import (
    CoachSpec, PracticeAnswer, PracticeGoal, PracticeJudge, PracticeStrength, PracticeSubScore, PracticeTotals,
)
from backend.judge._rule_patterns import SPECIFIC, sentences
from backend.llm import LLMUnavailable, generate_structured
from backend.voice_practice.goals import STRUCTURE_TARGET

log = logging.getLogger("undertone.voice_practice")

JUDGE_TIMEOUT_S = 25.0
LEAD_MAX_WORDS = 25  # a first sentence this short "leads with the point"
_WEAK_OPEN = re.compile(r"^\W*(?:um+|uh+|so+|well|i mean|i guess|i think maybe|honestly|basically)\b", re.I)


class _Strength(BaseModel):
    title: str = Field(description="3-6 words, plain")
    detail: str = Field(description="one sentence naming what the wearer actually did, quoting them briefly")
    from_answer: int = Field(description="1-based answer number")


class _Goal(BaseModel):
    title: str = Field(description="3-6 words, e.g. 'Lead with your answer'")
    target: str = Field(description="one concrete instruction for next time, checkable by listening")
    from_answer: int
    evidence: str = Field(description="a short quote (under 12 words) from that answer")


class StructureVerdict(BaseModel):
    structure_score: int = Field(ge=0, le=100, description="answer-first, a clear point, a concrete example or "
                                                            "number, a stated result; 0-100")
    structure_reason: str = Field(description="one plain sentence")
    summary: str = Field(description="one encouraging, specific sentence about the whole practice")
    strengths: list[_Strength] = Field(min_length=1, max_length=3)
    structure_goal: _Goal


@dataclass(frozen=True)
class Judgement:
    structure: PracticeSubScore
    strengths: list[PracticeStrength]
    structure_goal: PracticeGoal
    summary: str
    judged_by: PracticeJudge


def _prompt(coach: CoachSpec, answers: Sequence[PracticeAnswer], t: PracticeTotals,
            scores: Sequence[PracticeSubScore]) -> str:
    qa = [{"answer": a.index, "question": a.question, "said": a.text, "seconds": a.speaking_s,
           "fillers": a.fillers, "hedges": a.hedges} for a in answers]
    measured = [{"measure": s.label, "score": s.score, "detail": s.detail} for s in scores]
    return (
        "You are a speaking coach judging a spoken practice session. The wearer answered the coach's spoken "
        "questions out loud; the text is a speech transcript (fillers kept).\n"
        f"Coach: {coach.name}. Coach goal: {coach.goal}\n"
        f"Coach rubric: {coach.debrief_rubric or 'none'}\n"
        f"Measured numbers (already scored; agree with them, do not re-score them): {json.dumps(measured)}\n"
        f"Answers: {json.dumps(qa, ensure_ascii=False)}\n"
        "Judge STRUCTURE only: does each answer lead with its point, stay on the question, give a concrete "
        "example or number, and land a result? Strengths must be real moments from these answers. "
        "Quote only words that appear above. Never invent facts. Address the wearer as 'you'. No scores or "
        "percentages in any sentence."
    )


def _rule_structure(answers: Sequence[PracticeAnswer]) -> tuple[int, str]:
    if not answers:
        return 0, "No answers to judge."
    leads = sum(1 for a in answers if _leads(a.text))
    specific = sum(1 for a in answers if SPECIFIC.search(a.text))
    n = len(answers)
    score = round(40 + 30 * leads / n + 30 * specific / n)
    return score, f"{leads} of {n} answers opened with the point; {specific} of {n} gave a number or example."


def _leads(text: str) -> bool:
    first = next(iter(sentences(text)), "")
    return bool(first) and len(first.split()) <= LEAD_MAX_WORDS and not _WEAK_OPEN.search(first)


def _rule_strengths(answers: Sequence[PracticeAnswer], scores: Sequence[PracticeSubScore]) -> list[PracticeStrength]:
    best = sorted(scores, key=lambda s: -s.score)[:2]
    found = [PracticeStrength(title=f"Strong {s.label.lower()}", detail=s.detail[0].upper() + s.detail[1:] + ".",
                              from_answer=None) for s in best if s.score >= 70]
    specific = next((a for a in answers if SPECIFIC.search(a.text)), None)
    if specific is not None:
        found.append(PracticeStrength(title="Concrete detail", from_answer=specific.index,
                                      detail="You backed an answer with a number or a concrete example."))
    return found[:3]


def rule_judgement(answers: Sequence[PracticeAnswer], scores: Sequence[PracticeSubScore]) -> Judgement:
    score, reason = _rule_structure(answers)
    weakest = next((a for a in answers if not _leads(a.text)), answers[0] if answers else None)
    goal = PracticeGoal(measure="structure", title="Lead with your answer",
                        target="Say your answer in the first sentence, then one example, then the result",
                        target_min=STRUCTURE_TARGET, unit="structure score", actual=float(score),
                        from_answer=weakest.index if weakest else None,
                        evidence=(next(iter(sentences(weakest.text)), "")[:80] or None) if weakest else None)
    summary = f"You answered {len(answers)} question{'s' if len(answers) != 1 else ''} out loud."
    return Judgement(structure=PracticeSubScore(measure="structure", label="Structure", score=score, source="rules",
                                                detail=reason),
                     strengths=_rule_strengths(answers, scores), structure_goal=goal, summary=summary,
                     judged_by="rules")


def _from_verdict(v: StructureVerdict, n: int) -> Judgement:
    def answer_no(i: int) -> int | None:
        return i if 1 <= i <= n else None

    g = v.structure_goal
    goal = PracticeGoal(measure="structure", title=g.title, target=g.target, target_min=STRUCTURE_TARGET,
                        unit="structure score", actual=float(v.structure_score), from_answer=answer_no(g.from_answer),
                        evidence=g.evidence or None)
    strengths = [PracticeStrength(title=s.title, detail=s.detail, from_answer=answer_no(s.from_answer))
                 for s in v.strengths]
    return Judgement(structure=PracticeSubScore(measure="structure", label="Structure", score=v.structure_score,
                                                source="judged", detail=v.structure_reason),
                     strengths=strengths, structure_goal=goal, summary=v.summary, judged_by="gemini")


async def judge(coach: CoachSpec, answers: Sequence[PracticeAnswer], t: PracticeTotals,
                scores: Sequence[PracticeSubScore]) -> Judgement:
    """Gemini's judgement, or the rule-based one when Gemini is unavailable."""
    try:
        verdict = await generate_structured(_prompt(coach, answers, t, scores), StructureVerdict,
                                            timeout_s=JUDGE_TIMEOUT_S)
        return _from_verdict(verdict, len(answers))
    except LLMUnavailable as exc:
        log.info("practice judge: using rules (%s)", exc)
        return rule_judgement(answers, scores)
