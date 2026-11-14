"""Debrief generation: one LLM call, a rule check, one retry, then a local fallback.

`generate_debrief` never raises. Logs carry reasons and timings only, never transcript text.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from backend.contracts import Debrief, DebriefNumbers, Metrics, SessionSummary, TimelinePoint
from backend.debrief.local import assemble, fallback_debrief
from backend.debrief.prompt import build_prompt
from backend.debrief.rules import check_draft
from backend.debrief.wire import DebriefDraft
from backend.llm import LLMUnavailable, generate_structured
from backend.state import SessionState

log = logging.getLogger(__name__)

LLM_TIMEOUT_S = 15.0  # measured 6-12 s per call on 14 Nov
THINKING = "low"
MAX_ATTEMPTS = 2
TOTAL_BUDGET_S = 25.0   # both attempts together; the retry gets what is left
MIN_RETRY_S = 8.0       # skip the retry (use the fallback) if less than this is left


def _minimal_debrief(metrics: Metrics, timeline: list[TimelinePoint]) -> Debrief:
    """Last resort when even the local fallback fails. Always valid."""
    return Debrief(
        headline_fact=f"You talked {metrics.talk_ratio:.0%} of the time and asked {metrics.questions} questions.",
        strength="You finished the conversation and recorded it for review.",
        one_fix="Your turns ran long before you handed the conversation back.",
        if_then="When you have spoken for 30 seconds, end with a question.",
        numbers=DebriefNumbers(talk_ratio=metrics.talk_ratio, interruptions=metrics.interruptions,
                               questions=metrics.questions, fillers_per_min=metrics.fillers_per_min,
                               wpm=metrics.wpm),
        best_moment_quote="",
        timeline=list(timeline),
    )


def _safe_fallback(session: SessionState, metrics: Metrics, timeline: list[TimelinePoint],
                   last: SessionSummary | None) -> Debrief:
    try:
        return fallback_debrief(session, metrics, timeline, last)
    except Exception as exc:  # noqa: BLE001 - the debrief must always exist
        log.warning("fallback debrief failed (%s); using minimal debrief", type(exc).__name__)
        return _minimal_debrief(metrics, timeline)


async def _attempt(session: SessionState, metrics: Metrics, last: SessionSummary | None,
                   reasons: list[str], timeout_s: float) -> tuple[DebriefDraft, list[str]]:
    prompt = build_prompt(session, metrics, last, reasons or None)
    draft = await generate_structured(prompt, DebriefDraft, thinking=THINKING, timeout_s=timeout_s)
    return draft, check_draft(draft, session, metrics)


async def generate_with_info(session: SessionState, metrics: Metrics, timeline: list[TimelinePoint],
                             last: SessionSummary | None) -> tuple[Debrief, dict[str, Any]]:
    """Like `generate_debrief`, plus info: source (llm/llm_retry/fallback), attempts, reasons, elapsed_s."""
    started = time.perf_counter()
    info: dict[str, Any] = {"source": "fallback", "attempts": 0, "reasons": []}

    def done(debrief: Debrief) -> tuple[Debrief, dict[str, Any]]:
        info["elapsed_s"] = round(time.perf_counter() - started, 2)
        return debrief, info

    reasons: list[str] = []
    try:
        for attempt in range(MAX_ATTEMPTS):
            left = TOTAL_BUDGET_S - (time.perf_counter() - started)
            if attempt > 0 and left < MIN_RETRY_S:
                log.warning("no time left for a debrief retry (%.1f s); using fallback", left)
                break
            info["attempts"] = attempt + 1
            draft, reasons = await _attempt(session, metrics, last, reasons, min(LLM_TIMEOUT_S, left))
            info["reasons"] = list(info["reasons"]) + reasons
            if not reasons:
                debrief = assemble(draft, session, metrics, timeline, last)
                info["source"] = "llm" if attempt == 0 else "llm_retry"
                return done(debrief)
            log.warning("debrief draft rejected (attempt %d): %s", attempt + 1, "; ".join(reasons))
        else:
            log.warning("debrief drafts rejected twice; using fallback")
    except LLMUnavailable as exc:
        info["error"] = str(exc)
        log.warning("debrief LLM unavailable: %s", exc)
    except Exception as exc:  # noqa: BLE001 - never raise from the debrief
        info["error"] = type(exc).__name__
        log.warning("debrief generation failed: %s", type(exc).__name__)
    return done(_safe_fallback(session, metrics, timeline, last))


async def generate_debrief(session: SessionState, metrics: Metrics, timeline: list[TimelinePoint],
                           last: SessionSummary | None) -> Debrief:
    """Never raises: on LLM failure or a draft that breaks the rules, returns a local debrief."""
    try:
        debrief, _ = await generate_with_info(session, metrics, timeline, last)
        return debrief
    except Exception as exc:  # noqa: BLE001 - belt and braces
        log.warning("generate_debrief failed unexpectedly: %s", type(exc).__name__)
        return _minimal_debrief(metrics, timeline)
