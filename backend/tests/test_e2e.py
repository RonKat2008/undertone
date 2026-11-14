"""End-to-end: app lifespan + HTTP + bus, on the current stub packages (rule judge only)."""

from __future__ import annotations

import asyncio
import json
import os
import tempfile
from pathlib import Path
from typing import Any

# Settings are read at import time, so the environment must be set before importing backend.
_TMP = Path(tempfile.mkdtemp(prefix="undertone-e2e-"))
os.environ["DEV"] = "1"
os.environ["DEMO_POLICY"] = "1"
os.environ["USE_RULE_JUDGE_ONLY"] = "1"
os.environ["UNDERTONE_DB"] = str(_TMP / "e2e.db")
os.environ["UNDERTONE_ENV_FILE"] = str(_TMP / "does-not-exist.env")

import httpx  # noqa: E402

from backend.config import FIXTURES_DIR, settings  # noqa: E402
from backend.main import app  # noqa: E402

CORE_KEYS = {
    "interrupted", "asked_question", "question_type", "answered_the_question", "hedging",
    "rambling", "acknowledged", "tone", "clarity", "commitment_made",
}
TICK_WAIT_S = 1.3


def _fixture() -> list[dict[str, Any]]:
    lines = (FIXTURES_DIR / "demo_session.jsonl").read_text().splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def _events_through(turn_id: str) -> list[dict[str, Any]]:
    """Fixture events (motion + turns) up to and including the given turn, `at` stripped."""
    out: list[dict[str, Any]] = []
    for row in _fixture():
        out.append({k: v for k, v in row.items() if k != "at"})
        if row.get("turn_id") == turn_id:
            return out
    raise AssertionError(f"turn {turn_id} not in fixture")


def _turn(turn_id: str) -> dict[str, Any]:
    row = next(r for r in _fixture() if r.get("turn_id") == turn_id)
    return {k: v for k, v in row.items() if k != "at"}


async def _collect(stream: Any, out: list[Any]) -> None:
    async for event in stream:
        out.append(event)


async def _wait_for(pred: Any, timeout: float = 2.0) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + timeout
    while not pred():
        if loop.time() > deadline:
            raise AssertionError("condition not met in time")
        await asyncio.sleep(0.01)


class _Harness:
    """Runs the lifespan, an HTTP client, and a bus collector."""

    async def __aenter__(self) -> "_Harness":
        self._life = app.router.lifespan_context(app)
        await self._life.__aenter__()
        self.state = app.state.app
        self.events: list[Any] = []
        self._task = asyncio.create_task(_collect(self.state.bus.subscribe(), self.events))
        await asyncio.sleep(0)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.client.aclose()
        self._task.cancel()
        await asyncio.gather(self._task, return_exceptions=True)
        await self._life.__aexit__(*exc)

    def of(self, etype: str) -> list[Any]:
        return [e for e in self.events if e.type == etype]


async def test_full_session_flow() -> None:
    assert settings.dev and settings.demo_policy and settings.use_rule_judge_only
    async with _Harness() as h:
        c = h.client
        health = await c.get("/health")
        assert health.status_code == 200 and health.json()["ok"] is True

        r = await c.post("/session/start", json={})
        assert r.status_code == 200, r.text
        sid = r.json()["session_id"]
        assert sid

        for ev in _events_through("t04"):
            r = await c.post("/dev/publish", json=ev)
            assert r.status_code == 200, r.text
        await asyncio.sleep(TICK_WAIT_S)
        await h.state.bus.drain()

        bad = await c.post("/dev/publish", json={"type": "turn.final"})
        assert bad.status_code == 422
        body = bad.json()
        assert body["ok"] is False and body["error"]["code"] == "invalid_event"

        r = await c.post("/session/tap")
        assert r.status_code == 200, r.text
        assert r.json()["status"]["verdict"]
        r = await c.post("/session/bookmark", json={"text": "check this"})
        assert r.status_code == 200, r.text
        r = await c.post("/session/stop")
        assert r.status_code == 200, r.text
        assert r.json()["debrief"]["type"] == "debrief"
        await h.state.bus.drain()
        await _wait_for(lambda: bool(h.of("debrief")))

        types = {e.type for e in h.events}
        expected = {"session.started", "turn.final", "motion", "judge", "metrics", "status.reply",
                    "bookmark", "session.ended", "debrief"}
        assert expected <= types, expected - types

        judges = h.of("judge")
        assert judges
        for j in judges:
            assert j.source == "rules"
            assert CORE_KEYS <= set(j.results), CORE_KEYS - set(j.results)
        t04 = next(j for j in judges if j.turn_id == "t04")
        assert t04.results["interrupted"].p >= 0.8

        nudges = [n for n in h.of("nudge") if n.rule_id == "interrupt"]
        assert nudges, [n.rule_id for n in h.of("nudge")]
        assert nudges[0].latency_ms >= 0
        assert nudges[0].budget_left == 7

        order = [e.type for e in h.events]
        assert order.index("session.ended") < order.index("debrief")
        assert h.of("debrief")[-1].data.numbers.interruptions >= 1

        sessions = await c.get("/sessions")
        assert sessions.status_code == 200
        assert sid in [s["session_id"] for s in sessions.json()]
        deb = await c.get(f"/sessions/{sid}/debrief")
        assert deb.status_code == 200 and deb.json()
        coaches = await c.get("/coaches")
        assert coaches.status_code == 200
        assert "core" in [co["id"] for co in coaches.json()]
        for path in ("/mission/today", "/streak", "/profile"):
            r = await c.get(path)
            assert r.status_code == 200, (path, r.text)


async def test_promise_turn_bookmarks() -> None:
    async with _Harness() as h:
        c = h.client
        r = await c.post("/session/start", json={})
        assert r.status_code == 200, r.text
        for tid in ("t07", "t08"):
            r = await c.post("/dev/publish", json=_turn(tid))
            assert r.status_code == 200, r.text
        await h.state.bus.drain()
        await _wait_for(lambda: any(b.source == "promise" for b in h.of("bookmark")))
        promise = next(b for b in h.of("bookmark") if b.source == "promise")
        assert "I'll send you the deck tonight" in (promise.text or "")
        r = await c.post("/session/stop")
        assert r.status_code == 200, r.text
