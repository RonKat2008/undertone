"""The one seam between the brain and the phone's haptics.

Person C calls `register_sender(async_fn)` once (e.g. from backend/haptics/ at startup) with a
function that delivers a HapticCommand to the paired phone(s). Until then `send` just logs.
`send` never raises: a failed delivery is logged and the coaching loop carries on.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from backend.contracts import HapticCommand

log = logging.getLogger("undertone.haptics")

Sender = Callable[[HapticCommand], Awaitable[None]]


async def _log_sender(cmd: HapticCommand) -> None:
    log.info("haptic (no phone sender registered): %s %s", cmd.pattern, cmd.label)


_sender: Sender = _log_sender


def register_sender(fn: Sender) -> None:
    global _sender
    _sender = fn


def reset_sender() -> None:
    global _sender
    _sender = _log_sender


async def send(cmd: HapticCommand) -> None:
    try:
        await _sender(cmd)
    except Exception:
        log.exception("haptic send failed: %s", cmd.pattern)
