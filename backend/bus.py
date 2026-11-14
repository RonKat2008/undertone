"""In-process async pub/sub for BusEvents.

- `await bus.publish(event)`: model or dict; dicts are validated with parse_event.
- `bus.subscribe()`: async iterator of events (for /ws fan-out). Each subscriber has a
  bounded queue; when it is full the oldest event is dropped, so a slow or dead
  subscriber never blocks publishers.
- `bus.on("turn.final", handler)`: async handler, run as its own task per event so a slow
  handler never blocks the publisher. Handler errors are logged, never raised.
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Any

from pydantic import BaseModel

from backend.contracts import EVENT_TYPES, parse_event

log = logging.getLogger("undertone.bus")

Handler = Callable[[Any], Awaitable[None]]
QUEUE_SIZE = 500


class Bus:
    def __init__(self, queue_size: int = QUEUE_SIZE) -> None:
        self._queue_size = queue_size
        self._subscribers: set[asyncio.Queue[BaseModel]] = set()
        self._handlers: dict[str, list[Handler]] = {}
        self._tasks: set[asyncio.Task[None]] = set()

    def on(self, event_type: str, handler: Handler) -> None:
        if event_type != "*" and event_type not in EVENT_TYPES:
            raise ValueError(f"unknown event type: {event_type}")
        self._handlers = {**self._handlers, event_type: [*self._handlers.get(event_type, []), handler]}

    async def publish(self, event: BaseModel | dict[str, Any]) -> BaseModel:
        model = parse_event(event) if isinstance(event, dict) else event
        etype = getattr(model, "type", None)
        if etype not in EVENT_TYPES:
            raise ValueError(f"not a bus event: {type(model).__name__}")
        for q in list(self._subscribers):
            _put_drop_oldest(q, model)
        for handler in [*self._handlers.get(etype, []), *self._handlers.get("*", [])]:
            task = asyncio.create_task(self._run(handler, model))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
        return model

    async def _run(self, handler: Handler, model: BaseModel) -> None:
        try:
            await handler(model)
        except Exception:
            log.exception("bus handler %s failed on %s", getattr(handler, "__qualname__", handler),
                          getattr(model, "type", "?"))

    @asynccontextmanager
    async def _subscription(self) -> AsyncIterator[asyncio.Queue[BaseModel]]:
        q: asyncio.Queue[BaseModel] = asyncio.Queue(self._queue_size)
        self._subscribers.add(q)
        try:
            yield q
        finally:
            self._subscribers.discard(q)

    async def subscribe(self) -> AsyncIterator[BaseModel]:
        async with self._subscription() as q:
            while True:
                yield await q.get()

    @property
    def subscriber_count(self) -> int:
        return len(self._subscribers)

    async def drain(self) -> None:
        """Wait for in-flight handler tasks (tests and shutdown)."""
        while self._tasks:
            await asyncio.gather(*list(self._tasks), return_exceptions=True)


def _put_drop_oldest(q: asyncio.Queue[BaseModel], item: BaseModel) -> None:
    try:
        q.put_nowait(item)
    except asyncio.QueueFull:
        try:
            q.get_nowait()
        except asyncio.QueueEmpty:
            pass
        q.put_nowait(item)


def to_wire(event: BaseModel) -> dict[str, Any]:
    """JSON-ready dict for the wire (aliases applied)."""
    return event.model_dump(mode="json", by_alias=True)
