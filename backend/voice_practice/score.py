"""Measured sub-scores and the overall score. Deterministic: same numbers, same score.

Curves are smooth and capped below 100 (calibrate.py); few answers pull a score towards 70.
Only structure is judged (by Gemini, or the rule estimate in judge.py); every other sub-score
comes from the measured numbers. A measure that was not taken gives no sub-score.
"""

from __future__ import annotations

from collections import Counter
from typing import Sequence

from backend.contracts import PracticeAnswer, PracticeMeasure, PracticeSubScore, PracticeTotals
from backend.voice_practice.calibrate import band, decay, repetition, restarts, shrink

PACE_LOW, PACE_HIGH = 120.0, 165.0  # comfortable answer pace, words a minute
ANSWER_SHORT_S, ANSWER_LONG_S = 20.0, 90.0  # goal targets: a full answer, but under 90 seconds
CONCISE_LOW_S, CONCISE_HIGH_S = 20.0, 60.0  # the ideal band for scoring
START_LOW_S, START_HIGH_S = 0.6, 2.0  # a short breath before answering

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


def pace_score(answers: Sequence[PracticeAnswer], t: PracticeTotals) -> PracticeSubScore | None:
    if t.wpm is None:
        return None
    score = shrink(band(t.wpm, PACE_LOW, PACE_HIGH, 30.0, 35.0), len(answers))
    return PracticeSubScore(measure="pace", label=LABELS["pace"], score=_clamp(score, 5),
                            source="measured", detail=f"{t.wpm:.0f} words a minute")


def filler_detail(answers: Sequence[PracticeAnswer], t: PracticeTotals) -> str:
    counts = Counter(f for a in answers for f in a.fillers).most_common(3)
    named = ", ".join(f"“{w}” ×{n}" for w, n in counts)
    rate = f"{t.fillers_per_min:.1f} filler words a minute"
    return f"{rate} ({named})" if named else f"{rate}, none heard"


def filler_score(answers: Sequence[PracticeAnswer], t: PracticeTotals) -> PracticeSubScore | None:
    if t.fillers_per_min is None:
        return None
    score = shrink(decay(t.fillers_per_min, 9.0), len(answers))
    return PracticeSubScore(measure="fillers", label=LABELS["fillers"], score=_clamp(score, 5), source="measured",
                            detail=filler_detail(answers, t))


def _answer_concise(a: PracticeAnswer) -> float:
    """Ideal 20-60 s, thin below and rambling above (smooth), less up to 30 for repeating itself."""
    fit = band(a.speaking_s or 0.0, CONCISE_LOW_S, CONCISE_HIGH_S, 12.0, 45.0)
    return fit - min(30.0, 100 * repetition(a.text))


def concise_score(answers: Sequence[PracticeAnswer], t: PracticeTotals) -> PracticeSubScore | None:
    timed = [a for a in answers if a.speaking_s is not None]
    if not timed or t.mean_answer_s is None:
        return None
    score = shrink(sum(_answer_concise(a) for a in timed) / len(timed), len(timed))
    longest = max(a.speaking_s or 0.0 for a in timed)
    detail = f"answers averaged {_seconds(t.mean_answer_s)}, longest {_seconds(longest)}"
    return PracticeSubScore(measure="conciseness", label=LABELS["conciseness"], score=_clamp(score, 5),
                            source="measured", detail=detail)


def hedges_per_answer(answers: Sequence[PracticeAnswer]) -> float | None:
    return round(sum(len(a.hedges) for a in answers) / len(answers), 2) if answers else None


def _minutes(answers: Sequence[PracticeAnswer], t: PracticeTotals) -> float:
    """Speaking minutes; without word timings, words at a typical 150 a minute."""
    return max(0.25, (t.speaking_s / 60.0) if t.speaking_s else t.words / 150.0)


def confidence_score(answers: Sequence[PracticeAnswer], t: PracticeTotals) -> PracticeSubScore | None:
    """Hedges, fillers, false starts and long pauses, each per speaking minute, on one smooth curve."""
    if not answers or t.words == 0:
        return None
    mins = _minutes(answers, t)
    starts = sum(restarts(a.text) for a in answers)
    load = (6 * t.hedges + 2 * t.filler_count + 5 * starts + 4 * (t.long_pauses or 0)) / mins
    score = shrink(decay(load, 70.0), len(answers))
    detail = (f"{t.hedges} hedge{'s' if t.hedges != 1 else ''}, {starts} false start{'s' if starts != 1 else ''}"
              f" in {len(answers)} answer{'s' if len(answers) != 1 else ''}")
    if t.long_pauses is not None:
        detail += f", {t.long_pauses} long pause{'s' if t.long_pauses != 1 else ''}"
    return PracticeSubScore(measure="confidence", label=LABELS["confidence"], score=_clamp(score, 5),
                            source="measured", detail=detail)


def start_score(answers: Sequence[PracticeAnswer], t: PracticeTotals) -> PracticeSubScore | None:
    """Best after a short breath (0.6-2 s); lower for instant blurts and for long delays."""
    starts = [a.time_to_start_s for a in answers if a.time_to_start_s is not None]
    if not starts or t.mean_time_to_start_s is None:
        return None
    raw = sum(band(s, START_LOW_S, START_HIGH_S, 0.35, 2.5, 92.0) for s in starts) / len(starts)
    return PracticeSubScore(measure="responsiveness", label=LABELS["responsiveness"],
                            score=_clamp(shrink(raw, len(starts)), 5), source="measured",
                            detail=f"you started answering after {t.mean_time_to_start_s:.1f} s on average")


def measured_scores(answers: Sequence[PracticeAnswer], t: PracticeTotals) -> list[PracticeSubScore]:
    found = [pace_score(answers, t), filler_score(answers, t), concise_score(answers, t),
             confidence_score(answers, t), start_score(answers, t)]
    return [s for s in found if s is not None]


def overall(scores: Sequence[PracticeSubScore]) -> int:
    weighted = [(WEIGHTS[s.measure], s.score) for s in scores]
    total = sum(w for w, _ in weighted)
    return _clamp(sum(w * v for w, v in weighted) / total) if total else 0
