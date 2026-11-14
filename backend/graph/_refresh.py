"""Topic cache refresh: extract topics for finished sessions that have none cached yet.

Runs from `POST /graph/refresh` and lazily (fire-and-forget, after the response) from `GET /graph`.
One run at a time; a lazy request while a run is going is skipped, not queued.
"""

from __future__ import annotations

import asyncio
import logging

from backend.db import DB
from backend.graph._cache import load_topics, missing_sessions, save_topics
from backend.graph._load import load_lines, transcript_text
from backend.graph._topics import extract_topics

log = logging.getLogger(__name__)

MAX_PER_RUN = 25
_lock = asyncio.Lock()


def is_running() -> bool:
    return _lock.locked()


async def refresh_topics(db: DB, limit: int = MAX_PER_RUN) -> int:
    """Extract and cache topics for up to `limit` uncached sessions, newest first. Returns how many."""
    async with _lock:
        sids = missing_sessions(db, limit)
        known = sorted({label for labels in load_topics(db).values() for label in labels})
        for sid in sids:
            labels, source = await extract_topics(transcript_text(load_lines(db, sid)), known)
            save_topics(db, sid, labels, source)
            known = sorted({*known, *labels})
        return len(sids)


async def refresh_lazily(db: DB) -> None:
    """Background entry point: never raises, skips if a run is already going."""
    if is_running():
        return
    try:
        n = await refresh_topics(db)
    except Exception:  # a background refresh must never take the server down
        log.exception("background topic refresh failed")
        return
    if n:
        log.info("cached topics for %d session(s)", n)
