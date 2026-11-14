""""How am I doing?" (plan.md 4.1): one slow answer from live metrics. Never uses the budget."""

from __future__ import annotations

from backend.contracts import HapticPattern, Metrics, StatusVerdict
from backend.nudge.conditions import Condition

DEFAULT_TALK_TARGET = 0.6
ASK_WINDOW_S = 120.0
FIRST_QUESTION_BY_S = 60.0
TALK_PATH = ("metrics", "talk_ratio")


def talk_target(conds: list[Condition]) -> float:
    """The coach's talk-ratio threshold if it has a talk_ratio rule, else 0.6."""
    for c in conds:
        if c.path == TALK_PATH and c.op in (">", ">=") and isinstance(c.value, float):
            return c.value
    return DEFAULT_TALK_TARGET


class QuestionClock:
    """Remembers when the wearer's question count last went up (metrics only carry a count)."""

    def __init__(self) -> None:
        self.count = 0
        self.last_ts: float | None = None

    def observe(self, questions: int, now: float) -> None:
        if questions > self.count:
            self.count, self.last_ts = questions, now


def verdict_for(metrics: Metrics, now: float, target: float,
                clock: QuestionClock) -> tuple[StatusVerdict, HapticPattern]:
    if metrics.talk_ratio > target:
        return "talking_too_much", "status_talking"
    none_yet = metrics.questions == 0 and now > FIRST_QUESTION_BY_S
    stale = now > ASK_WINDOW_S and (clock.last_ts is None or now - clock.last_ts > ASK_WINDOW_S)
    if none_yet or stale:
        return "ask_question", "status_ask"
    return "good", "status_good"
