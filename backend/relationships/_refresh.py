"""Keep each person's relationship current. Plain async functions that never raise, safe to call
from a background task after a session ends.

A person is stale when their kept sessions differ from the ones already folded in. A refresh
re-infers over the recent bounded sample and blends (see _blend.py). A session that left the
kept set (later marked sensitive or noise) means the stored result is rebuilt from scratch.
One refresh per person at a time: a concurrent call waits for the running one and returns its
result without inferring again.
"""

from __future__ import annotations

import asyncio
import logging

from backend.contracts import Relationship
from backend.db import DB
from backend.relationships._blend import Memory, blend
from backend.relationships._infer import Decide, infer
from backend.relationships._sample import kept_session_ids, load_sample
from backend.relationships._store import Row, effective, load_row, load_rows, save_memory

log = logging.getLogger("undertone.relationships")

MAX_PER_RUN = 10
_locks: dict[str, asyncio.Lock] = {}
_stale_lock = asyncio.Lock()


def _lock(person_id: str) -> asyncio.Lock:
    return _locks.setdefault(person_id, asyncio.Lock())


def is_refreshing(person_id: str) -> bool:
    lock = _locks.get(person_id)
    return lock is not None and lock.locked()


def _stale(row: Row | None, kept: list[str]) -> bool:
    if row is None:
        return bool(kept)
    return row.user_kind is None and set(kept) != set(row.seen)


def known_people(db: DB) -> dict[str, str]:
    """person_id -> name: the people store plus any person id tagged on a session."""
    names = {p.person_id: p.name for p in db.list_people()}
    for r in db.query("SELECT DISTINCT person_id FROM sessions WHERE person_id IS NOT NULL"):
        names.setdefault(r["person_id"], r["person_id"])
    return names


def stale_people(db: DB) -> list[str]:
    rows = load_rows(db)
    return [pid for pid in sorted(known_people(db)) if _stale(rows.get(pid), kept_session_ids(db, pid))]


async def _refresh(db: DB, person_id: str, force: bool, decide: Decide | None,
                   rules_only: bool) -> Relationship | None:
    row = load_row(db, person_id)
    if row is not None and row.user_kind is not None:
        return effective(row)  # the wearer's label wins; no inference, no API spend
    kept = kept_session_ids(db, person_id)
    seen = row.seen if row is not None else frozenset()
    new, dropped = set(kept) - seen, seen - set(kept)
    if row is not None and not (new or dropped or force):
        return effective(row)
    old = Memory() if row is None or dropped else row.memory
    fresh = await infer(load_sample(db, person_id), decide=decide, rules_only=rules_only)
    fresh = fresh.model_copy(update={"based_on_sessions": len(kept)})
    memory = blend(old, fresh, has_new=bool(new) or bool(dropped))
    save_memory(db, person_id, memory, frozenset(kept))
    return effective(load_row(db, person_id))


async def refresh_person(db: DB, person_id: str, *, force: bool = False, decide: Decide | None = None,
                         rules_only: bool = False) -> Relationship | None:
    """Re-infer one person if they have a new (or lost a) kept conversation, or always with `force`.
    Returns the effective relationship, or None on failure. Never raises."""
    lock = _lock(person_id)
    if lock.locked():  # a refresh is running: wait for it and share its result, never infer twice
        async with lock:
            pass
        try:
            return effective(load_row(db, person_id))
        except Exception:  # noqa: BLE001
            return None
    async with lock:
        try:
            return await _refresh(db, person_id, force, decide, rules_only)
        except Exception:  # noqa: BLE001 - a background refresh must never take the server down
            log.exception("relationship refresh failed for %s", person_id)
            return None


async def refresh_stale(db: DB, limit: int = MAX_PER_RUN, *, decide: Decide | None = None,
                        rules_only: bool = False) -> int:
    """Refresh up to `limit` stale people. Returns how many were refreshed. Never raises; a call
    while another run is going is skipped, not queued."""
    if _stale_lock.locked():
        return 0
    async with _stale_lock:
        try:
            pids = stale_people(db)[:limit]
        except Exception:  # noqa: BLE001
            log.exception("listing stale relationships failed")
            return 0
        done = 0
        for pid in pids:
            if await refresh_person(db, pid, decide=decide, rules_only=rules_only) is not None:
                done += 1
        return done
