"""Automatic promise closing: did a later conversation with the same person have the wearer
report the promise done?

One structured LLM call per (promise, later conversation) pair, cached in commitment_checks, run
only from the background refresh. Only the promise text and the wearer's own lines from the later
conversation are sent. Conservative: a promise closes only when the model says done AND returns a
quote of at least MIN_QUOTE_CHARS that really appears in the wearer's lines. No LLM means no
check is made or cached, so nothing closes automatically. A manual state is never overridden.
"""

from __future__ import annotations

import json
import logging
import re

from pydantic import BaseModel

from backend.db import DB
from backend.graph._commitments import close_automatically, get_state, pending_checks, save_check
from backend.llm import LLMUnavailable, generate_structured

log = logging.getLogger(__name__)

MAX_CHECKS_PER_RUN = 10
MIN_QUOTE_CHARS = 8
MAX_WEARER_CHARS = 8_000
LLM_TIMEOUT_S = 20.0


class PromiseCheck(BaseModel):
    """LLM output."""

    done: bool = False
    quote: str = ""  # the wearer's exact words saying it is done


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", text.lower()).strip()


def is_supported(check: PromiseCheck, wearer_text: str) -> bool:
    """Done, with a real quote taken from the wearer's own lines."""
    quote = _norm(check.quote)
    return check.done and len(quote) >= MIN_QUOTE_CHARS and quote in _norm(wearer_text)


def _prompt(promise: str, wearer_text: str) -> str:
    return (
        "Earlier, a person promised: \"" + promise + "\"\n\n"
        "Below are only that person's own words from a later conversation. Answer done=true ONLY if "
        "they clearly say they already did what they promised (past tense, the same thing). Plans, "
        "intentions, apologies or 'I will' are NOT done. If done, copy their exact words that say so "
        "into quote (one sentence). Otherwise done=false and quote=\"\". "
        "Return JSON {\"done\": bool, \"quote\": str}.\n\nTheir words:\n" + wearer_text[:MAX_WEARER_CHARS]
    )


def _promise_text(db: DB, bookmark_id: int) -> str:
    rows = db.query("SELECT data_json FROM bookmarks WHERE id = ?", (bookmark_id,))
    try:
        return (json.loads(rows[0]["data_json"]).get("text") or "").strip() if rows else ""
    except (json.JSONDecodeError, AttributeError):
        return ""


def _wearer_text(db: DB, session_id: str) -> str:
    rows = db.query("SELECT data_json FROM turns WHERE session_id = ? AND speaker = 'me' ORDER BY start",
                    (session_id,))
    texts = []
    for r in rows:
        try:
            texts.append((json.loads(r["data_json"]).get("text") or "").strip())
        except (json.JSONDecodeError, AttributeError):
            continue
    return "\n".join(t for t in texts if t)


async def check_commitments(db: DB, limit: int = MAX_CHECKS_PER_RUN) -> int:
    """Run up to `limit` pending checks. Returns how many promises were closed. Stops at the first
    LLM failure (nothing is cached for that pair, so it is retried on a later run)."""
    closed = 0
    for bookmark_id, later in pending_checks(db, limit):
        if not get_state(db, bookmark_id).open:
            continue
        promise, wearer = _promise_text(db, bookmark_id), _wearer_text(db, later)
        if not promise or not wearer:
            save_check(db, bookmark_id, later, False, "")
            continue
        try:
            check = await generate_structured(_prompt(promise, wearer), PromiseCheck, thinking="low",
                                              timeout_s=LLM_TIMEOUT_S)
        except LLMUnavailable as exc:
            log.info("promise check skipped: %s", exc)
            break
        done = is_supported(check, wearer)
        save_check(db, bookmark_id, later, done, check.quote.strip() if done else "")
        if done:
            close_automatically(db, bookmark_id, later, check.quote.strip())
            closed += 1
    return closed
