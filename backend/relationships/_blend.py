"""Blend a fresh inference into the stored one, so one odd conversation never flips a label.

Rules, in order (old = stored inferred result, fresh = this refresh's result):
  1 nothing stored, or the stored kind is unknown       -> take fresh
  2 fresh is unknown (thin or mixed)                    -> keep old (session count updated)
  3 fresh is from rules and old from decisions          -> keep old (rules never overturn decisions)
  4 same kind                                           -> keep it; confidence = history-weighted mean
                                                           (history weight = sessions behind old, max 3)
                                                           + 0.05, capped by source; warmth the same
                                                           mean; formality/power/evidence from fresh
  5 different kind, old from rules, fresh from decisions -> take fresh
  6 different kind, with a new kept conversation        -> keep old at 0.85x confidence and note the
                                                           challenger; the same challenger winning
                                                           FLIP_AFTER refreshes in a row takes over
  7 different kind, no new conversation (a forced re-run) -> keep old unchanged
User labels live in their own column and are never passed through here.
"""

from __future__ import annotations

from dataclasses import dataclass

from backend.contracts import Relationship
from backend.relationships._features import CAPS

FLIP_AFTER = 2
MAX_HISTORY_WEIGHT = 3
AGREE_BONUS = 0.05
DOUBT_DECAY = 0.85


@dataclass(frozen=True)
class Memory:
    inferred: Relationship | None = None
    pending_kind: str | None = None  # a different kind that won the latest refresh(es)
    pending_count: int = 0


def _bump(old: Relationship, fresh: Relationship, **update: object) -> Relationship:
    return old.model_copy(update={"based_on_sessions": fresh.based_on_sessions, "updated_at": fresh.updated_at,
                                  **update})


def _agree(old: Relationship, fresh: Relationship) -> Relationship:
    w = max(1, min(old.based_on_sessions, MAX_HISTORY_WEIGHT))
    source = "decisions" if "decisions" in (old.source, fresh.source) else fresh.source
    conf = min(CAPS[source], (w * old.confidence + fresh.confidence) / (w + 1) + AGREE_BONUS)
    warmth = (w * old.warmth + fresh.warmth) / (w + 1)
    return fresh.model_copy(update={"confidence": round(conf, 2), "warmth": round(warmth, 2), "source": source})


def blend(old: Memory, fresh: Relationship, has_new: bool) -> Memory:
    prev = old.inferred
    if prev is None or prev.kind == "unknown":
        return Memory(inferred=fresh)
    if fresh.kind == "unknown" or (fresh.source == "rules" and prev.source == "decisions"):
        return Memory(_bump(prev, fresh), old.pending_kind, old.pending_count)
    if fresh.kind == prev.kind:
        return Memory(inferred=_agree(prev, fresh))
    if prev.source == "rules" and fresh.source == "decisions":
        return Memory(inferred=fresh)
    if not has_new:
        return old
    count = old.pending_count + 1 if old.pending_kind == fresh.kind else 1
    if count >= FLIP_AFTER:
        return Memory(inferred=fresh)
    doubted = _bump(prev, fresh, confidence=round(prev.confidence * DOUBT_DECAY, 2))
    return Memory(doubted, fresh.kind, count)
