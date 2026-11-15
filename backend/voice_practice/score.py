"""Measured sub-scores and the overall score. Deterministic: same numbers, same score.

Only structure is judged (by Gemini, or the rule estimate in judge.py); every other sub-score
comes from the measured numbers. A measure that was not taken gives no sub-score.
"""

from __future__ import annotations

from collections import Counter
from typing import Sequence

from backend.contracts import PracticeAnswer, PracticeMeasure, PracticeSubScore, PracticeTotals

PACE_LOW, PACE_HIGH = 120.0, 165.0  # comfortable answer pace, words a minute
ANSWER_SHORT_S, ANSWER_LONG_S = 20.0, 90.0  # a full answer, but under 90 seconds
QUICK_START_S, SLOW_START_S = 2.0, 6.0

WEIGHTS: dict[PracticeMeasure, float] = {
    "structure": 0.25, "fillers": 0.2, "pace": 0.15, "conciseness": 0.15, "confidence": 0.15,
    "responsiveness": 0.1,
}
LABELS: dict[PracticeMeasure, str] = {
    "pace": "Pace", "fillers": "Clarity", "conciseness": "Conciseness", "structure": "Structure",
    "confidence": "Confidence", "responsiveness": "Getting started",
}


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> int:
    return int(round(max(low, min(high, value))))


def _seconds(s: float) -> str:
    whole = int(round(s))
    return f"{whole} s" if whole < 60 else f"{whole // 60} min {whole % 60:02d} s"


def pace_score(t: PracticeTotals) -> PracticeSubScore | None:
    if t.wpm is None:
        return None
    off = max(PACE_LOW - t.wpm, t.wpm - PACE_HIGH, 0.0)
    return PracticeSubScore(measure="pace", label=LABELS["pace"], score=_clamp(100 - 1.5 * off, 15),
                            source="measured", detail=f"{t.wpm:.0f} words a minute")


def filler_detail(answers: Sequence[PracticeAnswer], t: PracticeTotals) -> str:
    counts = Counter(f for a in answers for f in a.fillers).most_common(3)
    named = ", ".join(f"“{w}” ×{n}" for w, n in counts)
    rate = f"{t.fillers_per_min:.1f} filler words a minute"
    return f"{rate} ({named})" if named else f"{rate}, none heard"


def filler_score(answers: Sequence[PracticeAnswer], t: PracticeTotals) -> PracticeSubScore | None:
    if t.fillers_per_min is None:
        return None
    return PracticeSubScore(measure="fillers", label=LABELS["fillers"],
                            score=_clamp(100 - 11 * t.fillers_per_min, 5), source="measured",
                            detail=filler_detail(answers, t))


def _length_penalty(seconds: float) -> float:
    if seconds < ANSWER_SHORT_S:
        return (ANSWER_SHORT_S - seconds) * 2.5
    if seconds > ANSWER_LONG_S:
        return (seconds - ANSWER_LONG_S) * 0.6
    return 0.0


def concise_score(answers: Sequence[PracticeAnswer], t: PracticeTotals) -> PracticeSubScore | None:
    timed = [a.speaking_s for a in answers if a.speaking_s is not None]
    if not timed or t.mean_answer_s is None:
        return None
    penalty = sum(_length_penalty(s) for s in timed) / len(timed)
    detail = f"answers averaged {_seconds(t.mean_answer_s)}, longest {_seconds(max(timed))}"
    return PracticeSubScore(measure="conciseness", label=LABELS["conciseness"], score=_clamp(100 - penalty, 20),
                            source="measured", detail=detail)


def hedges_per_answer(answers: Sequence[PracticeAnswer]) -> float | None:
    return round(sum(len(a.hedges) for a in answers) / len(answers), 2) if answers else None


def confidence_score(answers: Sequence[PracticeAnswer], t: PracticeTotals) -> PracticeSubScore | None:
    """Hedges per answer (the unit the confidence goal uses), less a little per long pause."""
    per_answer = hedges_per_answer(answers)
    if per_answer is None:
        return None
    pauses = (t.long_pauses or 0) / len(answers)
    score = _clamp(100 - 25 * per_answer - 5 * pauses, 10)
    detail = f"{t.hedges} hedge{'s' if t.hedges != 1 else ''} in {len(answers)} answer{'s' if len(answers) != 1 else ''}"
    if t.long_pauses is not None:
        detail += f", {t.long_pauses} long pause{'s' if t.long_pauses != 1 else ''}"
    return PracticeSubScore(measure="confidence", label=LABELS["confidence"], score=score, source="measured",
                            detail=detail)


def start_score(t: PracticeTotals) -> PracticeSubScore | None:
    s = t.mean_time_to_start_s
    if s is None:
        return None
    if s <= QUICK_START_S:
        score = 100.0
    elif s <= SLOW_START_S:
        score = 100 - (s - QUICK_START_S) / (SLOW_START_S - QUICK_START_S) * 50
    else:
        score = 40.0
    return PracticeSubScore(measure="responsiveness", label=LABELS["responsiveness"], score=_clamp(score),
                            source="measured", detail=f"you started answering after {s:.1f} s on average")


def measured_scores(answers: Sequence[PracticeAnswer], t: PracticeTotals) -> list[PracticeSubScore]:
    found = [pace_score(t), filler_score(answers, t), concise_score(answers, t), confidence_score(answers, t),
             start_score(t)]
    return [s for s in found if s is not None]


def overall(scores: Sequence[PracticeSubScore]) -> int:
    weighted = [(WEIGHTS[s.measure], s.score) for s in scores]
    total = sum(w for w, _ in weighted)
    return _clamp(sum(w * v for w, v in weighted) / total) if total else 0
