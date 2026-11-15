"""Is a spoken practice running right now? One at a time.

While it is, the band's hearing events are not delivered (backend/session.py checks
`practice_active()`): the band mic would hear the coach's voice from the laptop speaker and the
wearer's practice answers, open a "conversation" from them, judge it and buzz nudges during the
practice. The band, its mic and its Deepgram worker keep running, so capture resumes the moment
the practice ends.
"""

from __future__ import annotations

_active = False


def practice_active() -> bool:
    return _active


def try_enter() -> bool:
    """Claim the one practice slot. False when a practice is already running."""
    global _active
    if _active:
        return False
    _active = True
    return True


def leave() -> None:
    global _active
    _active = False
