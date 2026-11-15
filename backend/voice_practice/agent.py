"""Opening the Deepgram Voice Agent socket (wss://agent.deepgram.com/v1/agent/converse).

Order per the docs (voice-agent-message-flow): connect -> Welcome -> Settings -> SettingsApplied;
send nothing before Welcome and no audio before SettingsApplied. Auth: `Authorization: Token <key>`.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from backend.voice_practice.words import Connect, Socket, ws_connect

log = logging.getLogger("undertone.voice_practice")

AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse"
SETUP_TIMEOUT_S = 12.0


class AgentRefused(RuntimeError):
    """The agent could not be opened or configured. The message is safe to show (no secrets)."""


def _status(exc: Exception) -> int | None:
    response = getattr(exc, "response", None)
    code = getattr(response, "status_code", None) or getattr(exc, "status_code", None)
    return int(code) if isinstance(code, int) else None


async def _expect(ws: Socket, wanted: str) -> dict[str, Any]:
    while True:
        msg = await ws.recv()
        if isinstance(msg, bytes):
            continue
        data = json.loads(msg)
        kind = data.get("type")
        if kind == wanted:
            return data
        if kind == "Error":
            code = data.get("code") or "error"
            log.warning("voice agent refused settings: %s", code)
            raise AgentRefused(f"The coach's voice service refused the setup ({code}).")
        log.debug("voice agent: %s before %s", kind, wanted)


async def open_agent(key: str, settings: dict[str, Any], connect: Connect = ws_connect) -> Socket:
    """A configured agent socket, or AgentRefused."""
    try:
        ws = await asyncio.wait_for(connect(AGENT_URL, {"Authorization": f"Token {key}"}), SETUP_TIMEOUT_S)
    except asyncio.TimeoutError as exc:
        raise AgentRefused("The coach's voice service did not answer in time.") from exc
    except Exception as exc:  # noqa: BLE001 - HTTP refusal, DNS, TLS
        status = _status(exc)
        log.warning("voice agent connect failed: %s %s", type(exc).__name__, status or "")
        if status in (401, 403):
            raise AgentRefused("The coach's voice service did not accept the Deepgram key.") from exc
        raise AgentRefused("Could not reach the coach's voice service.") from exc
    try:
        await asyncio.wait_for(_expect(ws, "Welcome"), SETUP_TIMEOUT_S)
        await ws.send(json.dumps(settings))
        await asyncio.wait_for(_expect(ws, "SettingsApplied"), SETUP_TIMEOUT_S)
    except AgentRefused:
        await ws.close()
        raise
    except Exception as exc:  # noqa: BLE001 - timeout, closed socket, bad JSON
        await ws.close()
        raise AgentRefused("The coach's voice service closed during setup.") from exc
    return ws
