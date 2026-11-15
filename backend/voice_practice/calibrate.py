"""Smooth scoring curves for the measured sub-scores (no step functions).

Measured scores top out below 100 (`PEAK`) and are pulled towards a neutral `PRIOR` when there
are few answers, so a perfect 100 needs exceptional numbers over several answers and a typical
answer set lands around 55-85.
"""

from __future__ import annotations

import math
import re

PEAK = 95.0  # the best a measure gives inside its ideal band
PRIOR = 70.0  # where a score sits with no evidence
PRIOR_WEIGHT = 1.5  # answers' worth of pull towards PRIOR
_REPEAT = re.compile(r"\b(\w+)(?:,)?\s+\1\b", re.I)  # "the, the" / "I I": a false start


def band(x: float, lo: float, hi: float, soft_lo: float, soft_hi: float, peak: float = PEAK) -> float:
    """`peak` inside [lo, hi]; a Gaussian falloff outside, `soft_*` wide (one soft width: about 0.37 x peak)."""
    if x < lo:
        return peak * math.exp(-(((lo - x) / soft_lo) ** 2))
    if x > hi:
        return peak * math.exp(-(((x - hi) / soft_hi) ** 2))
    return peak


def decay(rate: float, scale: float, peak: float = PEAK) -> float:
    """`peak` at rate 0, falling smoothly: rate == scale gives about 0.37 x peak."""
    return peak * math.exp(-max(0.0, rate) / scale)


def shrink(score: float, n: int) -> float:
    """Few answers say little: pull the score towards PRIOR (1 answer keeps 40% of the gap)."""
    if n <= 0:
        return PRIOR
    return PRIOR + (score - PRIOR) * n / (n + PRIOR_WEIGHT)


def repetition(text: str) -> float:
    """Share of word trigrams that repeat an earlier trigram in the same answer (0 = none)."""
    words = re.findall(r"[a-z']+", text.lower())
    grams = [tuple(words[i:i + 3]) for i in range(len(words) - 2)]
    return 1 - len(set(grams)) / len(grams) if grams else 0.0


def restarts(text: str) -> int:
    """False starts: a word said twice in a row ("the, the"), or "sorry" / "let me start over"."""
    from backend.judge._rule_patterns import RESTART

    return len(_REPEAT.findall(text)) + sum(1 for m in RESTART.finditer(text) if not m.group(1))
