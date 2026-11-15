"""Goals for next time (with measurable targets) and the check of last time's goals.

A goal comes from a measured weakness: its target is a number, its `actual` is this session's
value, and `from_answer` names the answer it came from. Structure goals are worded by the
judge (judge.py) and checked against the structure score.
"""

from __future__ import annotations

from typing import Sequence

from backend.contracts import PracticeAnswer, PracticeGoal, PracticeGoalCheck, PracticeSubScore, PracticeTotals
from backend.voice_practice.score import ANSWER_LONG_S, ANSWER_SHORT_S, PACE_HIGH, PACE_LOW, hedges_per_answer

GOAL_BELOW = 80  # sub-scores under this become goals
MAX_GOALS, MIN_GOALS = 4, 2
FILLER_TARGET = 3.0
HEDGE_TARGET = 1.0
START_TARGET_S = 3.0
STRUCTURE_TARGET = 70.0


def _worst(answers: Sequence[PracticeAnswer], key) -> PracticeAnswer | None:  # type: ignore[no-untyped-def]
    scored = [a for a in answers if key(a) is not None]
    return max(scored, key=key) if scored else None


def filler_goal(answers: Sequence[PracticeAnswer], t: PracticeTotals) -> PracticeGoal | None:
    rate = t.fillers_per_min
    if rate is None:
        return None
    target = FILLER_TARGET if rate > FILLER_TARGET else max(1.0, round(rate / 2, 1))
    worst = _worst(answers, lambda a: len(a.fillers) or None)
    evidence = None
    if worst is not None:
        top = max(set(worst.fillers), key=worst.fillers.count)
        evidence = f"“{top}” ×{worst.fillers.count(top)} in that answer"
    return PracticeGoal(measure="fillers", title="Fewer filler words",
                        target=f"Under {target:g} filler words a minute; you had {rate:.1f}",
                        target_max=target, unit="filler words a minute", actual=rate,
                        from_answer=worst.index if worst else None, evidence=evidence)


def pace_goal(answers: Sequence[PracticeAnswer], t: PracticeTotals) -> PracticeGoal | None:
    if t.wpm is None:
        return None
    fast = t.wpm > PACE_HIGH
    worst = _worst(answers, (lambda a: a.wpm) if fast else (lambda a: -a.wpm if a.wpm else None))
    slow = t.wpm < PACE_LOW
    title = "Slow down a little" if fast else ("Pick up the pace" if slow else "Hold this pace")
    return PracticeGoal(measure="pace", title=title,
                        target=f"Between {PACE_LOW:.0f} and {PACE_HIGH:.0f} words a minute; you averaged {t.wpm:.0f}",
                        target_min=PACE_LOW, target_max=PACE_HIGH, unit="words a minute", actual=t.wpm,
                        from_answer=worst.index if worst else None,
                        evidence=f"{worst.wpm:.0f} words a minute there" if worst and worst.wpm else None)


def concise_goal(answers: Sequence[PracticeAnswer]) -> PracticeGoal | None:
    timed = [a for a in answers if a.speaking_s is not None]
    if not timed:
        return None
    longest = max(timed, key=lambda a: a.speaking_s or 0.0)
    shortest = min(timed, key=lambda a: a.speaking_s or 0.0)
    if (longest.speaking_s or 0.0) > ANSWER_LONG_S:
        secs = longest.speaking_s or 0.0
        return PracticeGoal(measure="conciseness", title="Shorter answers",
                            target=f"Every answer under {ANSWER_LONG_S:.0f} seconds; your longest ran {secs:.0f}",
                            target_max=ANSWER_LONG_S, unit="seconds, longest answer", actual=secs,
                            from_answer=longest.index, evidence=f"{secs:.0f} seconds")
    secs = shortest.speaking_s or 0.0
    if secs >= ANSWER_SHORT_S:
        return PracticeGoal(measure="conciseness", title="Keep answers this size",
                            target=f"Every answer under {ANSWER_LONG_S:.0f} seconds; your longest ran "
                                   f"{longest.speaking_s or 0.0:.0f}",
                            target_max=ANSWER_LONG_S, unit="seconds, longest answer",
                            actual=longest.speaking_s, from_answer=longest.index, evidence=None)
    return PracticeGoal(measure="conciseness", title="Say a little more",
                        target=f"At least {ANSWER_SHORT_S:.0f} seconds per answer; your shortest was {secs:.0f}",
                        target_min=ANSWER_SHORT_S, unit="seconds, shortest answer", actual=secs,
                        from_answer=shortest.index, evidence=f"{secs:.0f} seconds")


def confidence_goal(answers: Sequence[PracticeAnswer]) -> PracticeGoal | None:
    rate = hedges_per_answer(answers)
    if rate is None:
        return None
    target = HEDGE_TARGET if rate > HEDGE_TARGET else HEDGE_TARGET / 2  # already at one: halve it
    worst = _worst(answers, lambda a: len(a.hedges) or None)
    quotes = ", ".join(f"“{h}”" for h in dict.fromkeys(worst.hedges)) if worst else None
    return PracticeGoal(measure="confidence", title="Fewer hedges" if rate > HEDGE_TARGET / 2 else "Keep it direct",
                        target=f"At most {target:g} hedge{'s' if target != 1 else ''} an answer; you averaged {rate:g}",
                        target_max=target, unit="hedges an answer", actual=rate,
                        from_answer=worst.index if worst else None, evidence=quotes)


def start_goal(answers: Sequence[PracticeAnswer], t: PracticeTotals) -> PracticeGoal | None:
    s = t.mean_time_to_start_s
    if s is None:
        return None
    worst = _worst(answers, lambda a: a.time_to_start_s)
    return PracticeGoal(measure="responsiveness", title="Start sooner",
                        target=f"Start within {START_TARGET_S:g} seconds; you took {s:.1f} on average",
                        target_max=START_TARGET_S, unit="seconds to start", actual=s,
                        from_answer=worst.index if worst else None,
                        evidence=f"{worst.time_to_start_s:.1f} seconds there" if worst and worst.time_to_start_s else None)


def build_goals(answers: Sequence[PracticeAnswer], t: PracticeTotals, scores: Sequence[PracticeSubScore],
                structure_goal: PracticeGoal | None) -> list[PracticeGoal]:
    """2-4 goals, weakest measure first. A structure goal joins when structure is weak or to reach two."""
    makers = {"fillers": lambda: filler_goal(answers, t), "pace": lambda: pace_goal(answers, t),
              "conciseness": lambda: concise_goal(answers), "confidence": lambda: confidence_goal(answers),
              "responsiveness": lambda: start_goal(answers, t), "structure": lambda: structure_goal}
    ranked = sorted(scores, key=lambda s: s.score)
    weak = [s for s in ranked if s.score < GOAL_BELOW]
    picked = weak + [s for s in ranked if s not in weak][: max(0, MIN_GOALS - len(weak))]
    goals = [g for g in (makers[s.measure]() for s in picked) if g is not None]
    return goals[:MAX_GOALS]


def measure_now(goal: PracticeGoal, answers: Sequence[PracticeAnswer], t: PracticeTotals,
                structure: float | None) -> float | None:
    """This session's value of the measure a goal was set on, defined the same way as its `actual`."""
    timed = [a.speaking_s for a in answers if a.speaking_s is not None]
    values = {
        "fillers": t.fillers_per_min,
        "pace": t.wpm,
        "confidence": hedges_per_answer(answers),
        "responsiveness": t.mean_time_to_start_s,
        "structure": structure,
        "conciseness": (max(timed) if goal.target_max is not None else min(timed)) if timed else None,
    }
    return values[goal.measure]


def check_goal(goal: PracticeGoal, now: float | None) -> PracticeGoalCheck:
    if now is None:
        return PracticeGoalCheck(goal=goal, now=None, met=None, detail="Could not be measured this time")
    now = round(now, 2)
    met = ((goal.target_min is None or now >= goal.target_min)
           and (goal.target_max is None or now <= goal.target_max))
    unit = f" {goal.unit}" if goal.unit else ""
    before = f", down from {goal.actual:g}" if goal.actual is not None and now < goal.actual else ""
    before = before or (f", up from {goal.actual:g}" if goal.actual is not None and now > goal.actual else "")
    word = "Met" if met else "Not yet"
    return PracticeGoalCheck(goal=goal, now=now, met=met, detail=f"{word}: {now:g}{unit}{before}")


def check_previous(previous: Sequence[PracticeGoal], answers: Sequence[PracticeAnswer], t: PracticeTotals,
                   structure: float | None) -> list[PracticeGoalCheck]:
    return [check_goal(g, measure_now(g, answers, t, structure)) for g in previous]
