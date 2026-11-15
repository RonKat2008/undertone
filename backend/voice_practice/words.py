"""A second, listen-only Deepgram stream of the wearer's microphone, for word timings and fillers.

The voice agent's ConversationText carries no word timings, and its speech-to-text drops
"um"/"uh". This stream (Deepgram listen v1, Nova-2, filler_words=true, the same choice and
reasons as backend/stt/pipeline.py) is fed the same bytes, so its word times are stream time.
If it cannot connect, the practice still runs; timing measures are then left out.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Awaitable, Callable, Protocol
from urllib.parse import urlencode

from backend.stt.pipeline import stt_model
from backend.voice_practice.measure import TimedWord

log = logging.getLogger("undertone.voice_practice")

LISTEN_URL = "wss://api.deepgram.com/v1/listen"
KEEPALIVE_S = 5.0
FLUSH_TIMEOUT_S = 4.0


class Socket(Protocol):
    async def send(self, message: str | bytes) -> None: ...
    async def recv(self) -> str | bytes: ...
    async def close(self) -> None: ...


Connect = Callable[[str, dict[str, str]], Awaitable[Socket]]


async def ws_connect(url: str, headers: dict[str, str]) -> Socket:
    import websockets

    return await websockets.connect(url, additional_headers=headers, open_timeout=10, max_size=None)  # type: ignore[return-value]


def listen_url(sample_rate: int, keyterms: list[str]) -> str:
    params: list[tuple[str, str]] = [
        ("model", stt_model()), ("encoding", "linear16"), ("sample_rate", str(sample_rate)), ("channels", "1"),
        ("filler_words", "true"), ("punctuate", "true"), ("interim_results", "false"), ("language", "en"),
    ]
    model = stt_model()
    for term in keyterms[:50]:
        params.append(("keyterm", term) if model.startswith("nova-3") else ("keywords", term.split()[0]))
    return f"{LISTEN_URL}?{urlencode(params)}"


def parse_words(message: str) -> list[TimedWord]:
    """Final words from one listen v1 `Results` message; anything else gives []."""
    try:
        data: dict[str, Any] = json.loads(message)
    except (ValueError, TypeError):
        return []
    if data.get("type") != "Results" or not data.get("is_final"):
        return []
    alts = (data.get("channel") or {}).get("alternatives") or []
    raw = alts[0].get("words", []) if alts else []
    out = []
    for w in raw:
        try:
            out.append(TimedWord(text=str(w.get("punctuated_word") or w["word"]), start=float(w["start"]),
                                 end=float(w["end"])))
        except (KeyError, TypeError, ValueError):
            continue
    return out


class WordStream:
    def __init__(self, key: str, on_words: Callable[[list[TimedWord]], None], keyterms: list[str],
                 sample_rate: int = 16000, connect: Connect = ws_connect) -> None:
        self._key, self._on_words, self._keyterms = key, on_words, keyterms
        self._rate, self._connect = sample_rate, connect
        self._ws: Socket | None = None
        self._reader: asyncio.Task[None] | None = None
        self.failed: str | None = None

    async def start(self) -> bool:
        try:
            self._ws = await self._connect(listen_url(self._rate, self._keyterms),
                                           {"Authorization": f"Token {self._key}"})
        except Exception as exc:  # noqa: BLE001 - any failure: practise without word timings
            self.failed = type(exc).__name__
            log.warning("practice word stream unavailable: %s", self.failed)
            return False
        self._reader = asyncio.create_task(self._read())
        return True

    async def _read(self) -> None:
        assert self._ws is not None
        try:
            while True:
                msg = await self._ws.recv()
                if isinstance(msg, str):
                    words = parse_words(msg)
                    if words:
                        self._on_words(words)
        except Exception as exc:  # noqa: BLE001 - closed (normal at the end) or dropped
            log.debug("practice word stream ended: %s", type(exc).__name__)

    async def send_audio(self, chunk: bytes) -> None:
        if self._ws is None or self._reader is None or self._reader.done():
            return
        try:
            await self._ws.send(chunk)
        except Exception as exc:  # noqa: BLE001
            self.failed = type(exc).__name__

    async def keepalive(self) -> None:
        if self._ws is not None:
            try:
                await self._ws.send(json.dumps({"type": "KeepAlive"}))
            except Exception:  # noqa: BLE001
                pass

    async def finish(self) -> None:
        """Ask for the last words (CloseStream), wait briefly for them, then close."""
        if self._ws is None:
            return
        try:
            await self._ws.send(json.dumps({"type": "CloseStream"}))
            if self._reader is not None:
                await asyncio.wait_for(asyncio.shield(self._reader), FLUSH_TIMEOUT_S)
        except Exception:  # noqa: BLE001 - timeout or already closed: keep what arrived
            pass
        finally:
            await self.close()

    async def close(self) -> None:
        if self._reader is not None and not self._reader.done():
            self._reader.cancel()
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:  # noqa: BLE001
                pass
            self._ws = None
