"""JudgeTally: counts judged interruptions and questions, one verdict per turn.

A later verdict for the same turn_id replaces the earlier one, so re-judging never double counts.
"""

from __future__ import annotations

from typing import Any

from backend.contracts import JudgeEvent, NoulAnswer

INTERRUPTED_P = 0.8
QUESTION_P = 0.6


def _noul_at_least(results: Any, key: str, threshold: float) -> bool:
    if not isinstance(results, dict):
        return False
    answer = results.get(key)
    if not isinstance(answer, NoulAnswer):
        return False
    p = getattr(answer, "p", None)
    return isinstance(p, (int, float)) and p >= threshold


class JudgeTally:
    """Per-turn verdicts: turn_id -> (interrupted, asked_question)."""

    def __init__(self) -> None:
        self._verdicts: dict[str, tuple[bool, bool]] = {}

    def note(self, judge: JudgeEvent) -> None:
        turn_id = getattr(judge, "turn_id", None)
        if not isinstance(turn_id, str):
            return
        results = getattr(judge, "results", None)
        verdict = (
            _noul_at_least(results, "interrupted", INTERRUPTED_P),
            _noul_at_least(results, "asked_question", QUESTION_P),
        )
        self._verdicts = {**self._verdicts, turn_id: verdict}

    @property
    def interruptions(self) -> int:
        return sum(1 for interrupted, _ in self._verdicts.values() if interrupted)

    @property
    def questions(self) -> int:
        return len(self.question_turn_ids)

    @property
    def question_turn_ids(self) -> frozenset[str]:
        return frozenset(tid for tid, (_, asked) in self._verdicts.items() if asked)
