"""Coach Studio builder: one-sentence goal -> a valid CoachSpec via Gemini, with repair and fallback.

Never raises. Flow: generate -> enforce overrides -> validate. If invalid: apply lossless safe fixes;
otherwise one repair call (time permitting) -> overrides -> safe fixes -> validate. Anything still
invalid, an LLM failure, or an unexpected error -> the deterministic fallback coach.
"""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Literal

from backend.contracts import CoachSpec
from backend.llm import LLMUnavailable, generate_structured
from backend.studio.fallback import clean_goal, fallback_coach
from backend.studio.fixes import DROPPED, apply_safe_fixes, enforce_overrides, lost_content
from backend.studio.prompt import build_prompt, repair_prompt
from backend.studio.validate import validate_coach

log = logging.getLogger("undertone.studio.builder")

BuildSource = Literal["llm", "repaired", "fallback"]

FIRST_TIMEOUT_S = 30.0  # measured 15-26 s for a full spec on 14 Nov
REPAIR_TIMEOUT_S = 15.0
TOTAL_BUDGET_S = 45.0
MIN_REPAIR_WINDOW_S = 10.0
THINKING = "low"


@dataclass(frozen=True)
class BuildResult:
    spec: CoachSpec
    source: BuildSource
    elapsed_ms: float
    notes: list[str] = field(default_factory=list)  # errors seen / fixes applied, for logs and the UI


def _elapsed_s(t0: float) -> float:
    return time.perf_counter() - t0


def _finish(spec: CoachSpec, goal: str) -> tuple[CoachSpec, list[str], list[str]]:
    """Overrides, then safe fixes, then validation. Returns (spec, fix notes, remaining errors)."""
    spec = enforce_overrides(spec, goal)
    try:
        fixed, fix_notes = apply_safe_fixes(spec)
    except Exception as exc:  # a fixer bug must not discard a usable spec
        log.exception("apply_safe_fixes crashed")
        return spec, [f"{DROPPED} nothing; safe fixes crashed: {type(exc).__name__}"], validate_coach(spec)
    fixed = enforce_overrides(fixed, goal)
    return fixed, fix_notes, validate_coach(fixed)


async def _repair(goal: str, spec: CoachSpec, errors: list[str], t0: float,
                  notes: list[str]) -> CoachSpec | None:
    remaining = TOTAL_BUDGET_S - _elapsed_s(t0)
    if remaining < MIN_REPAIR_WINDOW_S:
        notes.append(f"skipped repair: only {remaining:.1f}s left")
        return None
    timeout = min(REPAIR_TIMEOUT_S, remaining - 1.0)
    t_rep = time.perf_counter()
    try:
        repaired = await generate_structured(repair_prompt(goal, spec.model_dump_json(), errors),
                                             CoachSpec, thinking=THINKING, timeout_s=timeout)
    except LLMUnavailable as exc:
        notes.append(f"repair failed: {exc}")
        log.warning("coach repair failed after %.0f ms: %s", (time.perf_counter() - t_rep) * 1000, exc)
        return None
    log.info("coach repair call took %.0f ms", (time.perf_counter() - t_rep) * 1000)
    return repaired


async def _build_with_llm(goal: str, t0: float, notes: list[str]) -> tuple[CoachSpec, BuildSource] | None:
    t_gen = time.perf_counter()
    try:
        first = await generate_structured(build_prompt(goal), CoachSpec, thinking=THINKING,
                                          timeout_s=FIRST_TIMEOUT_S)
    except LLMUnavailable as exc:
        notes.append(f"llm unavailable: {exc}")
        log.warning("coach generation failed after %.0f ms: %s", (time.perf_counter() - t_gen) * 1000, exc)
        return None
    log.info("coach generation call took %.0f ms", (time.perf_counter() - t_gen) * 1000)

    first = enforce_overrides(first, goal)
    errors = validate_coach(first)
    fixed, fix_notes, fixed_errors = _finish(first, goal)
    if not errors or (not fixed_errors and not lost_content(fix_notes)):
        notes.extend(f"first try: {e}" for e in errors)
        notes.extend(f"fix: {n}" for n in fix_notes)
        return fixed, "llm"

    notes.extend(f"first try: {e}" for e in errors)
    repaired = await _repair(goal, first, errors, t0, notes)
    if repaired is not None:
        rep_fixed, rep_notes, rep_errors = _finish(repaired, goal)
        notes.extend(f"fix: {n}" for n in rep_notes)
        if not rep_errors:
            return rep_fixed, "repaired"
        notes.extend(f"after repair: {e}" for e in rep_errors)
    if not fixed_errors:
        notes.extend(f"fix: {n}" for n in fix_notes)
        return fixed, "llm"
    notes.extend(f"still invalid: {e}" for e in fixed_errors)
    return None


async def build_coach_with_meta(goal: str) -> BuildResult:
    """Always returns a coach that validate_coach accepts."""
    t0 = time.perf_counter()
    clean = clean_goal(goal)
    notes: list[str] = []
    try:
        built = await _build_with_llm(clean, t0, notes)
    except Exception as exc:  # never raise to the caller; fall back instead
        log.exception("coach builder crashed; using fallback")
        notes.append(f"builder error: {type(exc).__name__}")
        built = None
    if built is not None:
        spec, source = built
        if not validate_coach(spec):
            elapsed = _elapsed_s(t0) * 1000
            log.info("coach built (%s) in %.0f ms: %s", source, elapsed, spec.id)
            return BuildResult(spec, source, elapsed, notes)
        notes.append("final spec failed validation; using fallback")
    spec = fallback_coach(clean)
    elapsed = _elapsed_s(t0) * 1000
    log.info("coach fallback in %.0f ms: %s", elapsed, spec.id)
    return BuildResult(spec, "fallback", elapsed, notes)


async def build_coach(goal: str) -> CoachSpec:
    return (await build_coach_with_meta(goal)).spec
