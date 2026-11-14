"""Nudge engine: turns judge + metrics + motion into at most one budgeted buzz (plan.md 4.0, 4.5).

FINAL PUBLIC INTERFACE (do not change signatures; add private modules inside backend/nudge/):

    class NudgeEngine:
        def __init__(self, coach: CoachSpec, policy: NudgePolicy) -> None
        def evaluate(self, judge: JudgeEvent | None, metrics: Metrics,
                     motion_state: MotionSnapshot | None, now: float, slip_ts: float
                     ) -> NudgeEvent | None
            # judge=None for the 1 Hz metric/motion-only pass.
            # now = seconds since session start (goes into NudgeEvent.ts and gap/cooldown maths).
            # slip_ts = wall clock (time.time()) when the slip was observed; latency_ms is
            #   computed from it. brain.py re-stamps latency_ms right before publishing.
            # Returns a nudge only if it should BUZZ (focus rule, budget, gap, cooldown,
            #   not snoozed, not silent). Non-focus rules that fire go to `quiet_marks`.
        def status_reply(self, metrics: Metrics, now: float) -> StatusReplyEvent
        def snooze(self, rule_id: str, now: float) -> None
        budget_left: int                      (property)
        quiet_marks: list[QuietMark]          (property; fired-but-silent rules, for the debrief)

    evaluate_condition(expr, env) in backend/nudge/conditions.py

Condition env built by `build_env` below: {"judge": {qid: answer.model_dump()},
"metrics": metrics.model_dump(), "motion": motion_state.model_dump()}. So rules read
`judge.interrupted.p`, `judge.tone.choice`, `judge.clarity.score`, `metrics.monologue_s`,
`motion.fidget_while_other_s`, ...

STUB: a working minimal policy (focus rule only, budget, min gap, per-rule cooldown, snooze,
silent). The worker adds tolerance bands vs baseline, confidence_threshold gating, success buzz,
practice-mode behaviour and fading.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any

from backend.contracts import (
    CoachSpec, JudgeEvent, Metrics, MotionSnapshot, NudgeEvent, NudgePolicy, NudgeRule,
    StatusReplyEvent,
)
from backend.nudge.conditions import evaluate_condition

__all__ = ["NudgeEngine", "QuietMark", "build_env", "evaluate_condition"]

TALK_RATIO_TARGET = 0.6
ASK_AFTER_S = 120.0


@dataclass(frozen=True)
class QuietMark:
    rule_id: str
    message: str
    reason: str
    ts: float


def build_env(judge: JudgeEvent | None, metrics: Metrics, motion_state: MotionSnapshot | None) -> dict[str, Any]:
    return {
        "judge": {k: v.model_dump() for k, v in judge.results.items()} if judge else {},
        "metrics": metrics.model_dump(),
        "motion": motion_state.model_dump() if motion_state else {},
    }


def _confidence_for(rule: NudgeRule, judge: JudgeEvent | None) -> float | None:
    if judge is None or not rule.when.startswith("judge."):
        return None
    qid = rule.when.split(".")[1]
    ans = judge.results.get(qid)
    return ans.confidence if ans else None


class NudgeEngine:
    def __init__(self, coach: CoachSpec, policy: NudgePolicy) -> None:
        self.coach = coach
        self.policy = policy
        self._rules: list[NudgeRule] = [r for r in [*coach.nudge_rules, *coach.motion_rules]
                                        if r.enabled is not False]
        self._used = 0
        self._last_buzz: float | None = None
        self._last_fire: dict[str, float] = {}
        self._snoozed: set[str] = set()
        self._quiet: list[QuietMark] = []

    @property
    def budget_left(self) -> int:
        return max(0, self.policy.budget_per_session - self._used)

    @property
    def quiet_marks(self) -> list[QuietMark]:
        return list(self._quiet)

    def snooze(self, rule_id: str, now: float) -> None:
        self._snoozed = {*self._snoozed, rule_id}

    def _cooling(self, rule: NudgeRule, now: float) -> bool:
        last = self._last_fire.get(rule.id)
        return last is not None and now - last < (rule.cooldown_s or 0)

    def evaluate(self, judge: JudgeEvent | None, metrics: Metrics, motion_state: MotionSnapshot | None,
                 now: float, slip_ts: float) -> NudgeEvent | None:
        env = build_env(judge, metrics, motion_state)
        for rule in self._rules:
            if self._cooling(rule, now) or not evaluate_condition(rule.when, env):
                continue
            self._last_fire = {**self._last_fire, rule.id: now}
            reason = f"{rule.when}"
            buzz_ok = (rule.id == self.policy.focus_rule_id and not self.policy.silent
                       and rule.id not in self._snoozed and self.budget_left > 0
                       and (self._last_buzz is None or now - self._last_buzz >= self.policy.min_gap_s))
            if not buzz_ok:
                self._quiet = [*self._quiet, QuietMark(rule.id, rule.message, reason, now)]
                continue
            self._used += 1
            self._last_buzz = now
            return NudgeEvent(
                rule_id=rule.id, haptic=rule.haptic, message=rule.message, reason=reason,
                confidence=_confidence_for(rule, judge),
                latency_ms=round((time.time() - slip_ts) * 1000, 1),
                budget_left=self.budget_left, ts=now,
            )
        return None

    def status_reply(self, metrics: Metrics, now: float) -> StatusReplyEvent:
        if metrics.talk_ratio > TALK_RATIO_TARGET:
            return StatusReplyEvent(verdict="talking_too_much", haptic="status_talking", ts=now)
        if metrics.questions == 0 and now > ASK_AFTER_S:
            return StatusReplyEvent(verdict="ask_question", haptic="status_ask", ts=now)
        return StatusReplyEvent(verdict="good", haptic="status_good", ts=now)
