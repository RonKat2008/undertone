"""Keep each conversation's final Deepgram words (text, timings, speaker label) for voice memory.

Fed from SessionController.on_final_words (backend/session.py), on the event loop:

    log = WordLog()
    ctl.on_final_words = log.add          # add(session_id | None, stream_offset_s, words)
    words = log.take(session_id)           # conversation-clock TimedWords, oldest first

Always-on opens a conversation only after its first turn is final, so the words of that turn
arrive while no session is open: a short rolling buffer of stream-time words is kept and the
ones at or after the conversation's t=0 are carried into it when it opens.
"""

from __future__ import annotations

import logging
from collections import deque
from collections.abc import Iterable
from typing import Any

from backend.voices.types import TimedWord

log = logging.getLogger("undertone.voices")

RECENT_WORDS = 400  # rolling buffer of stream-time words heard outside a conversation
PRE_ROLL_S = 0.5
MAX_WORDS = 20_000  # per conversation (several hours of speech): beyond this, words are dropped
MAX_SESSIONS = 4  # conversations whose words are waiting to be taken


def _key(w: TimedWord) -> tuple[float, str]:
    return (round(w.start, 2), w.text)


class WordLog:
    def __init__(self) -> None:
        self._recent: deque[TimedWord] = deque(maxlen=RECENT_WORDS)
        self._sessions: dict[str, list[TimedWord]] = {}
        self._seen: dict[str, set[tuple[float, str]]] = {}

    def add(self, session_id: str | None, offset_s: float, words: Iterable[Any]) -> None:
        """Stream-time words (anything with text/start/end/label). Never raises."""
        try:
            batch = [TimedWord(str(w.text), float(w.start), float(w.end), int(w.label)) for w in words]
        except (AttributeError, TypeError, ValueError):
            log.warning("word log: unreadable words ignored")
            return
        if session_id is None:
            self._recent.extend(batch)
            return
        if session_id not in self._sessions:
            self._open(session_id, offset_s)
        self._append(session_id, offset_s, batch)

    def _open(self, session_id: str, offset_s: float) -> None:
        while len(self._sessions) >= MAX_SESSIONS:  # never taken (voice memory off or failed)
            oldest = next(iter(self._sessions))
            self._sessions.pop(oldest, None)
            self._seen.pop(oldest, None)
        self._sessions[session_id] = []
        self._seen[session_id] = set()
        carried = [w for w in self._recent if w.start >= offset_s - PRE_ROLL_S]
        self._recent.clear()
        self._append(session_id, offset_s, carried)

    def _append(self, session_id: str, offset_s: float, batch: list[TimedWord]) -> None:
        words, seen = self._sessions[session_id], self._seen[session_id]
        for w in batch:
            moved = TimedWord(w.text, round(max(0.0, w.start - offset_s), 3),
                              round(max(0.0, w.end - offset_s), 3), w.label)
            if _key(moved) in seen or len(words) >= MAX_WORDS:
                continue
            seen.add(_key(moved))
            words.append(moved)

    def take(self, session_id: str) -> list[TimedWord]:
        """The conversation's words, oldest first; forgets them."""
        self._seen.pop(session_id, None)
        return sorted(self._sessions.pop(session_id, []), key=lambda w: (w.start, w.end))
