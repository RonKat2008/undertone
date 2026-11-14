"""NudgeEngine: the budgeted, single-focus buzz policy (plan.md 4.0, 4.5).

Why it is sparing: one focus habit per conversation, a small budget spaced out, pace only
outside a personal tolerance band, a rare "success" buzz as information. Everything else
that fires is kept as a quiet mark for the laptop and the debrief.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, replace

from backend.config import load_settings
from backend.contracts import (
    CoachSpec, HapticPattern, JudgeEvent, Metrics, MotionSnapshot, NudgeEvent, NudgePolicy,
    NudgeQuietEvent, NudgeRule, StatusReplyEvent,
)
from backend.nudge._env import build_env
from backend.nudge._reason import describe
from backend.nudge.conditions import Condition, ConditionError, evaluate_parsed, parse_condition
from backend.nudge.status import QuestionClock, talk_target, verdict_for

log = logging.getLogger("undertone.nudge")

DEFAULT_COOLDOWN_S = 20.0
SUCCESS_HAPTIC = "success"
WPM_PATH = ("metrics", "wpm")
UPPER_OPS = frozenset({">", ">="})
# Session-cumulative ratios are noise on a tiny sample (one "um" in a 5 s first answer reads as
# 12/min; whoever speaks first has talk_ratio 1.0), so rules on them wait this long to fire.
RATE_WARMUP_S = 30.0
RATE_PATHS = frozenset({("metrics", "fillers_per_min"), ("metrics", "talk_ratio")})


@dataclass(frozen=True)
class QuietMark:
    rule_id: str
    message: str
    reason: str
    ts: float
    haptic: HapticPattern = "tap"


@dataclass(frozen=True)
class _Rule:
    rule: NudgeRule
    cond: Condition

    @property
    def id(self) -> str:
        return self.rule.id

    @property
    def is_judge(self) -> bool:
        return self.cond.path[0] == "judge"

    @property
    def cooldown(self) -> float:
        return self.rule.cooldown_s if self.rule.cooldown_s is not None else DEFAULT_COOLDOWN_S


@dataclass(frozen=True)
class _Hit:
    rule: _Rule
    reason: str
    confidence: float | None


def _compile(rules: list[NudgeRule]) -> list[_Rule]:
    out: list[_Rule] = []
    for r in rules:
        if r.enabled is False:
            continue
        try:
            out.append(_Rule(r, parse_condition(r.when)))
        except ConditionError as exc:
            log.warning("skipping rule %s: %s", r.id, exc)
    return out


class NudgeEngine:
    def __init__(self, coach: CoachSpec, policy: NudgePolicy) -> None:
        self.coach = coach
        self.policy = policy
        self._demo = load_settings().demo_policy
        self._rules = _compile([*coach.nudge_rules, *coach.motion_rules])
        self._talk_target = talk_target([r.cond for r in self._rules])
        self._questions = QuestionClock()
        self._used = 0
        self._success_used = False
        self._last_buzz: float | None = None
        self._last_rule_buzz: dict[str, float] = {}
        self._last_mark: dict[str, float] = {}
        self._snoozed: frozenset[str] = frozenset()
        self._quiet: tuple[QuietMark, ...] = ()
        self._drained = 0

    # ---------- public read-only state ----------
    @property
    def budget_left(self) -> int:
        return max(0, self.policy.budget_per_session - self._used)

    @property
    def quiet_marks(self) -> list[QuietMark]:
        return list(self._quiet)

    def drain_quiet_marks(self) -> list[NudgeQuietEvent]:
        """Quiet marks recorded since the previous drain, as `nudge.quiet` events."""
        fresh = self._quiet[self._drained:]
        self._drained = len(self._quiet)
        return [NudgeQuietEvent(rule_id=m.rule_id, haptic=m.haptic, message=m.message,
                                reason=m.reason, ts=m.ts) for m in fresh]

    def snooze(self, rule_id: str, now: float) -> None:
        self._snoozed = self._snoozed | {rule_id}

    # ---------- evaluation ----------
    def evaluate(self, judge: JudgeEvent | None, metrics: Metrics, motion_state: MotionSnapshot | None,
                 now: float, slip_ts: float) -> NudgeEvent | None:
        self._questions.observe(metrics.questions, now)
        env = build_env(judge, metrics, motion_state)
        live = [r for r in self._rules if now >= RATE_WARMUP_S or r.cond.path not in RATE_PATHS]
        hits = [h for h in (self._check(r, env, judge, metrics) for r in live) if h is not None]
        winner = self._pick([h for h in hits if self._may_buzz(h.rule, now)])
        for h in hits:
            if h is not winner:
                self._mark(h, now)
        if winner is None:
            return None
        return self._buzz(winner, now, slip_ts)

    def _check(self, r: _Rule, env: dict[str, object], judge: JudgeEvent | None,
               metrics: Metrics) -> _Hit | None:
        cond = self._effective(r.cond, metrics)
        if not evaluate_parsed(cond, env):
            return None
        confidence: float | None = None
        if r.is_judge:
            answer = judge.results.get(cond.path[1]) if judge is not None else None
            if answer is None or answer.confidence < self.coach.confidence_threshold:
                return None
            confidence = answer.confidence
        return _Hit(r, describe(cond, env, r.cond, metrics.baseline_wpm, self.policy.tolerance),
                    confidence)

    def _effective(self, cond: Condition, metrics: Metrics) -> Condition:
        """Tolerance band: pace only, never above the rule's own threshold."""
        base = metrics.baseline_wpm
        if cond.path != WPM_PATH or cond.op not in UPPER_OPS or not base or not isinstance(cond.value, float):
            return cond
        return replace(cond, value=max(cond.value, base * (1 + self.policy.tolerance)))

    def _may_buzz(self, r: _Rule, now: float) -> bool:
        is_success = r.rule.haptic == SUCCESS_HAPTIC
        if self.policy.silent or r.id in self._snoozed or self.budget_left <= 0:
            return False
        if is_success and self._success_used:
            return False
        if not (self._demo or is_success or r.id == self.policy.focus_rule_id):
            return False
        if self._last_buzz is not None and now - self._last_buzz < self.policy.min_gap_s:
            return False
        last = self._last_rule_buzz.get(r.id)
        return last is None or now - last >= r.cooldown

    def _pick(self, candidates: list[_Hit]) -> _Hit | None:
        if not candidates:
            return None
        focus = self.policy.focus_rule_id

        def rank(h: _Hit) -> tuple[bool, float]:
            return (h.rule.id == focus, h.confidence if h.confidence is not None else 1.0)

        return max(candidates, key=rank)  # max keeps the first of equal ranks (rule order)

    def _mark(self, hit: _Hit, now: float) -> None:
        """Judge rules mark every judged slip; metric/motion rules that stay true are deduped."""
        last = self._last_mark.get(hit.rule.id)
        if not hit.rule.is_judge and last is not None and now - last < hit.rule.cooldown:
            return
        self._last_mark = {**self._last_mark, hit.rule.id: now}
        r = hit.rule.rule
        self._quiet = (*self._quiet, QuietMark(r.id, r.message, hit.reason, now, r.haptic))

    def _buzz(self, hit: _Hit, now: float, slip_ts: float) -> NudgeEvent:
        r = hit.rule.rule
        self._used += 1
        self._last_buzz = now
        self._last_rule_buzz = {**self._last_rule_buzz, r.id: now}
        self._last_mark = {**self._last_mark, r.id: now}
        if r.haptic == SUCCESS_HAPTIC:
            self._success_used = True
        return NudgeEvent(
            rule_id=r.id, haptic=r.haptic, message=r.message, reason=hit.reason,
            confidence=hit.confidence, latency_ms=round(max(0.0, time.time() - slip_ts) * 1000, 1),
            budget_left=self.budget_left, ts=now,
        )

    # ---------- "How am I doing?" ----------
    def status_reply(self, metrics: Metrics, now: float) -> StatusReplyEvent:
        self._questions.observe(metrics.questions, now)
        verdict, haptic = verdict_for(metrics, now, self._talk_target, self._questions)
        return StatusReplyEvent(verdict=verdict, haptic=haptic, ts=now)
