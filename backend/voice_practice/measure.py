"""Speaking measures for one spoken practice: per answer and overall.

Everything here is measured from what was heard. Word timings come from the word stream
(backend/voice_practice/words.py); without them, timing measures are None, never guessed.
Filler and word counting reuse backend/metrics/text.py; hedges reuse the judge's HEDGE pattern.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Sequence

from backend.contracts import PracticeAnswer, PracticeTotals
from backend.judge._rule_patterns import HEDGE
from backend.metrics.text import count_words, find_fillers
from backend.stt.fillers import DEFAULT_FILLERS

LONG_PAUSE_S = 2.0  # a gap between two words this long counts as a long pause
MIN_TIMED_S = 3.0  # shorter speaking spans give no pace (one word is not a rate)


@dataclass(frozen=True)
class TimedWord:
    text: str
    start: float
    end: float


@dataclass(frozen=True)
class AnswerRecord:
    """One question and what the wearer said back, before measuring."""

    index: int
    question: str
    agent_text: str  # the voice agent's own transcript (it drops "um"/"uh")
    words: tuple[TimedWord, ...] = field(default_factory=tuple)  # word stream, keeps fillers
    coach_done_at: float | None = None  # coach audio finished playing in the browser (stream time)


def _round(value: float | None, digits: int = 1) -> float | None:
    return None if value is None else round(value, digits)


def answer_text(rec: AnswerRecord) -> str:
    """The word stream's text when there is one (it keeps fillers), else the agent's."""
    if rec.words:
        return " ".join(w.text for w in rec.words)
    return rec.agent_text.strip()


def _long_pauses(words: Sequence[TimedWord]) -> int:
    return sum(1 for a, b in zip(words, words[1:]) if b.start - a.end >= LONG_PAUSE_S)


def _time_to_start(rec: AnswerRecord) -> float | None:
    if rec.coach_done_at is None or not rec.words:
        return None
    gap = rec.words[0].start - rec.coach_done_at
    return round(gap, 2) if gap >= 0 else None  # negative: they spoke over the coach


def measure_answer(rec: AnswerRecord, filler_words: Sequence[str]) -> PracticeAnswer:
    text = answer_text(rec)
    words = count_words(text)
    fillers = find_fillers(text, filler_words or DEFAULT_FILLERS)
    hedges = [m.group(0).lower() for m in HEDGE.finditer(text)]
    speaking = rec.words[-1].end - rec.words[0].start if rec.words else None
    timed = speaking is not None and speaking >= MIN_TIMED_S
    return PracticeAnswer(
        index=rec.index,
        question=rec.question.strip(),
        text=text,
        words=words,
        speaking_s=_round(speaking),
        wpm=_round(words / speaking * 60.0) if timed else None,
        fillers=fillers,
        fillers_per_min=_round(len(fillers) / speaking * 60.0, 2) if timed else None,
        hedges=hedges,
        long_pauses=_long_pauses(rec.words) if rec.words else None,
        time_to_start_s=_time_to_start(rec),
    )


def _mean(values: Sequence[float]) -> float | None:
    return sum(values) / len(values) if values else None


def totals(answers: Sequence[PracticeAnswer]) -> PracticeTotals:
    timed = [a for a in answers if a.speaking_s is not None and a.speaking_s >= MIN_TIMED_S]
    seconds = sum(a.speaking_s or 0.0 for a in timed)
    timed_words = sum(a.words for a in timed)
    timed_fillers = sum(len(a.fillers) for a in timed)
    all_fillers = [f for a in answers for f in a.fillers]
    pauses = [a.long_pauses for a in answers if a.long_pauses is not None]
    starts = [a.time_to_start_s for a in answers if a.time_to_start_s is not None]
    return PracticeTotals(
        answers=len(answers),
        words=sum(a.words for a in answers),
        speaking_s=_round(seconds) if timed else None,
        wpm=_round(timed_words / seconds * 60.0) if timed else None,
        filler_count=len(all_fillers),
        fillers_per_min=_round(timed_fillers / seconds * 60.0, 2) if timed else None,
        top_fillers=[w for w, _ in Counter(all_fillers).most_common(3)],
        hedges=sum(len(a.hedges) for a in answers),
        long_pauses=sum(pauses) if pauses else None,
        mean_answer_s=_round(_mean([a.speaking_s for a in timed])) if timed else None,  # type: ignore[arg-type]
        mean_time_to_start_s=_round(_mean(starts), 2) if starts else None,
    )
