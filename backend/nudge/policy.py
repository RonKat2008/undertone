"""Fading nudge policy: the coach buzzes less as the wearer improves.

Guidance hypothesis: frequent feedback creates dependence, so the budget shrinks
once the focus habit improves, and every fifth session is a scheduled no-buzz
session to test unassisted performance (plan.md 4.0/4.5).
"""

from __future__ import annotations

import math

from backend.contracts import NudgePolicy

FADE_WINDOW = 3
SILENT_EVERY = 5
MIN_BUDGET = 1


def _improved(rates: list[float]) -> bool:
    """True if the last FADE_WINDOW rates are strictly decreasing (lower is better)."""
    if len(rates) < FADE_WINDOW:
        return False
    window = rates[-FADE_WINDOW:]
    if any(math.isnan(r) for r in window):
        return False
    return all(a > b for a, b in zip(window, window[1:]))


def next_policy(
    policy: NudgePolicy, recent_focus_rates: list[float], session_index: int
) -> NudgePolicy:
    """Return the policy for the upcoming (1-based) session without mutating the input."""
    budget = policy.budget_per_session
    if _improved(recent_focus_rates):
        budget = max(MIN_BUDGET, budget - 1)
    silent = session_index > 0 and session_index % SILENT_EVERY == 0
    return policy.model_copy(update={"budget_per_session": budget, "silent": silent})
