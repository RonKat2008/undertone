"""Tests for backend/bus.py: in-process async pub/sub."""

from __future__ import annotations

import asyncio
import time
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from backend.bus import Bus, to_wire
from backend.contracts import BookmarkEvent, HapticCommand, SessionEndedEvent

WAIT_S = 2.0


def bookmark(ts: float) -> BookmarkEvent:
    return BookmarkEvent(source="phone", text=None, ts=ts)


async def wait_for(predicate: Any, timeout: float = WAIT_S) -> None:
    deadline = time.monotonic() + timeout
    while not predicate():
        if time.monotonic() > deadline:
            raise AssertionError("condition not met in time")
        await asyncio.sleep(0.001)


async def collect(bus: Bus, n: int, out: list[BaseModel]) -> None:
    async for event in bus.subscribe():
        out.append(event)
        if len(out) >= n:
            break


async def test_two_subscribers_receive_events_in_order() -> None:
    bus = Bus()
    got_a: list[BaseModel] = []
    got_b: list[BaseModel] = []
    tasks = [asyncio.create_task(collect(bus, 5, got_a)), asyncio.create_task(collect(bus, 5, got_b))]
    await asyncio.sleep(0)
    assert bus.subscriber_count == 2

    for i in range(5):
        await bus.publish(bookmark(float(i)))
    await asyncio.wait_for(asyncio.gather(*tasks), WAIT_S)

    assert [e.ts for e in got_a] == [0.0, 1.0, 2.0, 3.0, 4.0]  # type: ignore[attr-defined]
    assert [e.ts for e in got_b] == [0.0, 1.0, 2.0, 3.0, 4.0]  # type: ignore[attr-defined]


async def test_publish_dict_is_validated() -> None:
    bus = Bus()
    model = await bus.publish({"type": "session.ended", "session_id": "s-1"})
    assert isinstance(model, SessionEndedEvent)
    assert to_wire(model) == {"type": "session.ended", "session_id": "s-1"}


async def test_publish_invalid_dict_raises() -> None:
    bus = Bus()
    with pytest.raises(ValidationError):
        await bus.publish({"type": "session.ended"})
    with pytest.raises(ValidationError):
        await bus.publish({"type": "nope", "session_id": "s-1"})


async def test_publish_non_event_model_raises() -> None:
    bus = Bus()
    with pytest.raises(ValueError):
        await bus.publish(HapticCommand(pattern="tap", label="not a bus event"))


def test_on_unknown_event_type_raises() -> None:
    with pytest.raises(ValueError):
        Bus().on("not.real", _noop)


async def _noop(_: Any) -> None:
    return None


async def test_on_handler_is_called() -> None:
    bus = Bus()
    seen: list[str] = []
    wildcard: list[str] = []

    async def handler(event: Any) -> None:
        seen.append(event.session_id)

    async def any_handler(event: Any) -> None:
        wildcard.append(event.type)

    bus.on("session.ended", handler)
    bus.on("*", any_handler)
    await bus.publish({"type": "session.ended", "session_id": "s-1"})
    await bus.publish(bookmark(1.0))
    await bus.drain()

    assert seen == ["s-1"]
    assert wildcard == ["session.ended", "bookmark"]


async def test_failing_handler_does_not_break_publish_or_others() -> None:
    bus = Bus()
    seen: list[str] = []

    async def boom(_: Any) -> None:
        raise RuntimeError("handler exploded")

    async def ok(event: Any) -> None:
        seen.append(event.session_id)

    bus.on("session.ended", boom)
    bus.on("session.ended", ok)
    await bus.publish({"type": "session.ended", "session_id": "s-1"})
    await bus.publish({"type": "session.ended", "session_id": "s-2"})
    await bus.drain()

    assert seen == ["s-1", "s-2"]


async def test_slow_subscriber_does_not_block_and_keeps_newest() -> None:
    queue_size = 10
    total = 2000
    bus = Bus(queue_size=queue_size)
    first = asyncio.Event()
    resume = asyncio.Event()
    got: list[BaseModel] = []

    async def slow() -> None:
        async for event in bus.subscribe():
            got.append(event)
            if len(got) == 1:
                first.set()
                await resume.wait()  # stop reading while the publisher floods
            if len(got) >= 1 + queue_size:
                break

    task = asyncio.create_task(slow())
    await asyncio.sleep(0)
    await bus.publish(bookmark(-1.0))
    await asyncio.wait_for(first.wait(), WAIT_S)

    started = time.monotonic()
    for i in range(total):
        await bus.publish(bookmark(float(i)))
    elapsed = time.monotonic() - started
    assert elapsed < 1.0

    resume.set()
    await asyncio.wait_for(task, WAIT_S)
    tail = [e.ts for e in got[1:]]  # type: ignore[attr-defined]
    assert tail == [float(i) for i in range(total - queue_size, total)]


async def test_aclose_removes_subscriber() -> None:
    bus = Bus()
    agen = bus.subscribe()
    pending = asyncio.ensure_future(agen.__anext__())
    await asyncio.sleep(0)
    assert bus.subscriber_count == 1

    await bus.publish(bookmark(1.0))
    assert (await asyncio.wait_for(pending, WAIT_S)).ts == 1.0  # type: ignore[attr-defined]
    await agen.aclose()
    assert bus.subscriber_count == 0


async def test_break_out_of_loop_removes_subscriber() -> None:
    bus = Bus()
    got: list[BaseModel] = []
    task = asyncio.create_task(collect(bus, 1, got))
    await asyncio.sleep(0)
    assert bus.subscriber_count == 1

    await bus.publish(bookmark(1.0))
    await asyncio.wait_for(task, WAIT_S)
    # Breaking out leaves the generator to be finalized by the loop's asyncgen hook.
    await wait_for(lambda: bus.subscriber_count == 0)
    assert len(got) == 1


async def test_cancelled_consumer_removes_subscriber() -> None:
    bus = Bus()
    task = asyncio.create_task(collect(bus, 100, []))
    await asyncio.sleep(0)
    assert bus.subscriber_count == 1
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert bus.subscriber_count == 0
