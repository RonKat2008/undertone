"""Topic aliases: one canonical label per topic across every cached session.

Reads (GET /graph, /reports/*) call `topic_map`, which is pure rules over stored rows and writes
nothing. The background refresh calls `consolidate_topics`: rules first, then ONE structured LLM
call over the full canonical label set to catch merges the rules miss ("q1 planning" /
"quarter planning"). Its result is stored in `topic_aliases` and re-used; labels already stored
are never sent again and a stored canonical never moves. With no LLM nothing is stored and the
rules keep applying in memory, so ids stay the same either way.
"""

from __future__ import annotations

import logging
import time

from pydantic import BaseModel, Field

from backend.db import DB
from backend.graph._cache import ensure_table as ensure_topics_table
from backend.graph._cache import load_topics_ordered
from backend.graph._merge import assign, is_weak
from backend.llm import LLMUnavailable, generate_structured

log = logging.getLogger(__name__)

MAX_LABELS_PER_CALL = 300
LLM_TIMEOUT_S = 20.0
TABLE_SQL = (
    "CREATE TABLE IF NOT EXISTS topic_aliases ("
    " label TEXT PRIMARY KEY, canonical TEXT NOT NULL, source TEXT NOT NULL, created_at REAL NOT NULL)"
)


class TopicGroup(BaseModel):
    labels: list[str] = Field(default_factory=list)


class TopicGroups(BaseModel):
    """LLM output: groups of labels that name the same subject."""

    groups: list[TopicGroup] = Field(default_factory=list)


def ensure_table(db: DB) -> None:
    db.execute(TABLE_SQL)


def load_aliases(db: DB) -> dict[str, str]:
    """Stored label -> canonical, in the order they were stored."""
    ensure_table(db)
    rows = db.query("SELECT label, canonical FROM topic_aliases ORDER BY created_at, rowid")
    return {r["label"]: r["canonical"] for r in rows}


def first_seen_labels(db: DB) -> list[str]:
    """Every cached topic label once, in the order it was first cached."""
    return list(dict.fromkeys(label for _, labels in load_topics_ordered(db) for label in labels))


def topic_map(db: DB) -> dict[str, str]:
    """label -> canonical for every cached label: stored aliases plus rules for the rest. No writes."""
    return assign(first_seen_labels(db), load_aliases(db))


def pending_labels(db: DB) -> list[str]:
    aliases = load_aliases(db)
    return [label for label in first_seen_labels(db) if label not in aliases and not is_weak(label)]


def _prompt(labels: list[str]) -> str:
    return (
        "These are topic labels from one person's conversations. Group labels that name the SAME "
        "subject (synonyms, plural/singular, a more or less specific wording of the same thing, for "
        "example 'coffee place' and 'coffee shop'). Do not group labels that are merely related "
        "('hiring' and 'firing', 'lisbon trip' and 'paris trip'). Leave a label out if it has no "
        "duplicate. Use the labels exactly as written. Return JSON {\"groups\": [{\"labels\": [...]}]}."
        "\n\nLabels:\n" + "\n".join(labels)
    )


def _redirects(groups: TopicGroups, canonicals: list[str], fixed: set[str]) -> dict[str, str]:
    """new canonical -> canonical it merges into. Never moves a stored (`fixed`) canonical and skips
    any group that would join two stored canonicals."""
    order = {c: i for i, c in enumerate(canonicals)}
    out: dict[str, str] = {}
    for group in groups.groups:
        members = [m for m in dict.fromkeys(x.strip().lower() for x in group.labels) if m in order]
        stored = [m for m in members if m in fixed]
        movable = [m for m in members if m not in fixed and m not in out]
        if len(members) < 2 or len(stored) > 1 or not movable:
            continue
        target = stored[0] if stored else min(movable, key=order.__getitem__)
        out.update({m: target for m in movable if m != target})
    return out


def _resolve(c: str, redirect: dict[str, str]) -> str:
    seen = {c}
    while c in redirect and redirect[c] not in seen:
        c = redirect[c]
        seen.add(c)
    return c


async def consolidate_topics(db: DB) -> int:
    """Store canonicals for labels not stored yet (rules + one LLM pass). Returns labels stored;
    0 when there is nothing new or the LLM is unavailable (nothing is stored then)."""
    ensure_topics_table(db)
    aliases = load_aliases(db)
    new = pending_labels(db)
    if not new:
        return 0
    proposed = assign(new, aliases)
    canonicals = list(dict.fromkeys(proposed.values()))[:MAX_LABELS_PER_CALL]
    try:
        groups = await generate_structured(_prompt(canonicals), TopicGroups, thinking="low",
                                           timeout_s=LLM_TIMEOUT_S)
    except LLMUnavailable as exc:
        log.info("topic consolidation skipped (rules apply in memory): %s", exc)
        return 0
    redirect = _redirects(groups, canonicals, set(aliases.values()))
    now = time.time()
    for i, label in enumerate(new):
        rule = proposed[label]
        final = _resolve(rule, redirect)
        db.execute("INSERT OR IGNORE INTO topic_aliases (label, canonical, source, created_at) VALUES (?, ?, ?, ?)",
                   (label, final, "llm" if final != rule else "rules", now + i * 1e-6))
    return len(new)
