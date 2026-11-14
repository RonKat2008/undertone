"""One relationship inference over a sample: one Decisions call, rules on any failure. Never raises.

Mirrors backend/capture/verdict.py: closed questions, a generous deadline (not on the live path),
an injectable `decide` for tests and the eval, and `source` recording which path answered.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable

from backend.contracts import JudgeAnswer, Relationship
from backend.judge import decisions
from backend.relationships._features import CAPS, Inference, map_features
from backend.relationships._questions import QUESTIONS, features_from_answers, usable
from backend.relationships._rules import rule_features
from backend.relationships._sample import Sample, format_sample, thin_reason

log = logging.getLogger("undertone.relationships")

INFER_TIMEOUT_S = 30.0  # background only; a cold first call measured 16.8 s
MIN_USABLE_ANSWERS = 6  # of 11; fewer and the answer set is too broken to trust
RULES_CAP = CAPS["rules"]

Decide = Callable[..., Awaitable[dict[str, JudgeAnswer]]]


def to_relationship(person_id: str, inf: Inference, based_on: int, now: float) -> Relationship:
    return Relationship(person_id=person_id, kind=inf.kind, confidence=inf.confidence, formality=inf.formality,
                        power=inf.power, warmth=inf.warmth, evidence=list(inf.evidence), source=inf.source,
                        based_on_sessions=based_on, updated_at=now)


def thin(person_id: str, reason: str, based_on: int, now: float) -> Relationship:
    return Relationship(person_id=person_id, kind="unknown", confidence=0.0, evidence=[reason], source="rules",
                        based_on_sessions=based_on, updated_at=now)


def _rules(sample: Sample) -> Inference:
    return map_features(rule_features(sample), sample.words(), "rules")


async def _decisions(sample: Sample, decide: Decide, timeout_s: float) -> Inference:
    answers = await decide(format_sample(sample), QUESTIONS, timeout_s=timeout_s)
    if usable(answers) < MIN_USABLE_ANSWERS:
        raise ValueError(f"only {usable(answers)} usable answers")
    return map_features(features_from_answers(answers), sample.words(), "decisions")


async def infer(sample: Sample, *, decide: Decide | None = None, rules_only: bool = False,
                timeout_s: float = INFER_TIMEOUT_S, now: float | None = None) -> Relationship:
    """The fresh (not yet blended) relationship for this sample. Never raises."""
    now = time.time() if now is None else now
    based_on = len(sample.session_ids) or len(sample.conversations)
    reason = thin_reason(sample)
    if reason is not None:  # never guess from a short exchange, and never spend a call on it
        return thin(sample.person_id, reason, based_on, now)
    if not rules_only:
        t0 = time.perf_counter()
        try:
            inf = await _decisions(sample, decide or decisions.decide, timeout_s)
            log.info("relationship for %s: %s (decisions, %.0f ms)", sample.person_id, inf.kind,
                     (time.perf_counter() - t0) * 1000)
            return to_relationship(sample.person_id, inf, based_on, now)
        except Exception as exc:  # noqa: BLE001 - DecisionsUnavailable, bad answers, anything else
            log.warning("relationship decisions unavailable for %s (%s); using rules", sample.person_id,
                        type(exc).__name__)
    return to_relationship(sample.person_id, _rules(sample), based_on, now)
