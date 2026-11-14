"""Background refresh, the only place the graph calls the LLM:
    1. extract topics for finished sessions that have none cached yet,
    2. consolidate topic labels (_aliases.py, one call when there are new labels),
    3. check open promises against later conversations with the same person (_closing.py).

Runs from `POST /graph/refresh` and lazily (fire-and-forget, after the response) from `GET /graph`.
One run at a time; a lazy request while a run is going is skipped, not queued.
"""

from __future__ import annotations

import asyncio
import logging

from dataclasses import dataclass

from backend.db import DB
from backend.graph._aliases import consolidate_topics, pending_labels
from backend.graph._cache import load_topics, missing_sessions, save_topics
from backend.graph._closing import check_commitments
from backend.graph._commitments import pending_checks
from backend.graph._load import load_lines, transcript_text
from backend.graph._topics import extract_topics

log = logging.getLogger(__name__)

MAX_PER_RUN = 25
_lock = asyncio.Lock()


def is_running() -> bool:
    return _lock.locked()


@dataclass(frozen=True)
class RefreshResult:
    sessions: int  # sessions whose topics were extracted
    labels: int  # topic labels given a stored canonical
    closed: int  # promises closed automatically


async def _extract(db: DB, limit: int) -> int:
    sids = missing_sessions(db, limit)
    known = sorted({label for labels in load_topics(db).values() for label in labels})
    for sid in sids:
        labels, source = await extract_topics(transcript_text(load_lines(db, sid)), known)
        save_topics(db, sid, labels, source)
        known = sorted({*known, *labels})
    return len(sids)


async def refresh_topics(db: DB, limit: int = MAX_PER_RUN) -> int:
    """Extract and cache topics for up to `limit` uncached sessions, newest first. Returns how many."""
    async with _lock:
        return await _extract(db, limit)


async def refresh_all(db: DB, limit: int = MAX_PER_RUN) -> RefreshResult:
    """Topics, then label consolidation, then promise checks."""
    async with _lock:
        sessions = await _extract(db, limit)
        labels = await consolidate_topics(db)
        closed = await check_commitments(db)
        return RefreshResult(sessions=sessions, labels=labels, closed=closed)


def needs_refresh(db: DB) -> bool:
    return bool(missing_sessions(db, 1) or pending_labels(db) or pending_checks(db, 1))


async def refresh_lazily(db: DB) -> None:
    """Background entry point: never raises, skips if a run is already going."""
    if is_running():
        return
    try:
        result = await refresh_all(db)
    except Exception:  # a background refresh must never take the server down
        log.exception("background graph refresh failed")
        return
    if result.sessions or result.labels or result.closed:
        log.info("graph refresh: topics for %d session(s), %d label(s) consolidated, %d promise(s) closed",
                 result.sessions, result.labels, result.closed)
