"""Relationships: what each person the wearer talks with is to them (friend, boss, family, ...),
inferred from how the two of them talk. Gemini Decisions API with a rule fallback.

PUBLIC INTERFACE (no dependency on graph, growth or reports code):

    relationship_for(db, person_id) -> Relationship | None       # cheap, read-only, sync
    relationships_by_person(db) -> dict[str, Relationship]       # cheap, read-only, sync
    async refresh_person(db, person_id, *, force=False) -> Relationship | None   # never raises
    async refresh_stale(db, limit=10) -> int                     # never raises
    set_user_kind(db, person_id, kind) / clear_user_kind(db, person_id)
    router: GET /relationships, GET|PUT|DELETE /people/{id}/relationship,
            POST /people/{id}/relationship/refresh

Modules:
    _sample.py     kept sessions with the person -> a recent, bounded sample; minimum-speech rule
    _questions.py  the closed Decisions questions; answers -> Features (invalid answers discarded)
    _rules.py      keyword/pattern Features for the fallback
    _features.py   Features -> kind, confidence, formality, power, warmth, evidence (deterministic)
    _infer.py      one inference: Decisions, rules on any failure
    _blend.py      fresh result + stored result (one odd conversation never flips a label)
    _store.py      the `relationships` table (created on use) and the user override
    _refresh.py    refresh_person / refresh_stale, one refresh per person at a time
    examples.py    synthetic conversations for tests and scripts/eval_relationships.py
"""

from __future__ import annotations

from backend.contracts import Relationship, RelationshipKind
from backend.db import DB
from backend.relationships._refresh import refresh_person, refresh_stale
from backend.relationships._store import effective, load_row, load_rows, save_user_kind

__all__ = ["clear_user_kind", "refresh_person", "refresh_stale", "relationship_for", "relationships_by_person",
           "router", "set_user_kind"]


def relationship_for(db: DB, person_id: str) -> Relationship | None:
    """The person's effective relationship (user label first), or None if never analysed."""
    return effective(load_row(db, person_id))


def relationships_by_person(db: DB) -> dict[str, Relationship]:
    out = {pid: effective(row) for pid, row in load_rows(db).items()}
    return {pid: r for pid, r in out.items() if r is not None}


def set_user_kind(db: DB, person_id: str, kind: RelationshipKind) -> None:
    save_user_kind(db, person_id, kind)


def clear_user_kind(db: DB, person_id: str) -> None:
    save_user_kind(db, person_id, None)


from backend.relationships.routes import router  # noqa: E402
