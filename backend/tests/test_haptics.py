"""Haptics Connector: pairing, device socket, app approval, /v1/haptics, bus forwarding.

Runs on a throwaway FastAPI app (router only) so it does not depend on backend.main.
"""

from __future__ import annotations

import asyncio
import os
import tempfile
from pathlib import Path
from typing import Any

# Settings are read at import time; keep this file from touching the real database or .env
# when it runs on its own (test_e2e sets the same variables when it is collected first).
_TMP = Path(tempfile.mkdtemp(prefix="undertone-haptics-"))
os.environ.setdefault("UNDERTONE_DB", str(_TMP / "haptics.db"))
os.environ.setdefault("UNDERTONE_ENV_FILE", str(_TMP / "does-not-exist.env"))

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend import haptics, haptics_port  # noqa: E402
from backend.bus import Bus  # noqa: E402
from backend.contracts import HapticCommand, NudgeEvent, StatusReplyEvent  # noqa: E402
from backend.haptics.hub import DEDUPE_S, RATE_MAX, Hub  # noqa: E402


class FakeSocket:
    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    async def send_json(self, data: Any) -> None:
        self.sent.append(data)


class FakeKV:
    def __init__(self) -> None:
        self.data: dict[str, Any] = {}

    def kv_get(self, key: str, default: Any = None) -> Any:
        return self.data.get(key, default)

    def kv_set(self, key: str, value: Any) -> None:
        self.data[key] = value


@pytest.fixture(autouse=True)
def _reset_port() -> Any:
    yield
    haptics_port.reset_sender()


def _app() -> FastAPI:
    app = FastAPI()
    app.include_router(haptics.router)
    return app


def _nudge(**over: Any) -> NudgeEvent:
    base: dict[str, Any] = dict(rule_id="pace", haptic="slow_down", message="Slow down",
                                reason="214 wpm, your normal is 160", confidence=None, latency_ms=900.0,
                                budget_left=2, ts=31.0)
    return NudgeEvent(**{**base, **over})


# ---------- HTTP + WebSocket through the router ----------
def test_router_mounts_on_a_bare_app_and_pairs() -> None:
    with TestClient(_app()) as c:
        r = c.post("/pair", json={"name": "Demo phone"})
        assert r.status_code == 200, r.text
        p = r.json()
        assert p["ok"] and p["device_id"].startswith("d-") and len(p["code"]) == 6
        assert set(p) >= {"server_url", "device_id", "device_token", "code", "qr"}
        assert p["device_token"] in p["qr"]

        claimed = c.post("/pair/claim", json={"code": p["code"].lower()})
        assert claimed.status_code == 200 and claimed.json()["device_token"] == p["device_token"]
        assert c.post("/pair/claim", json={"code": "ZZZZZZ"}).status_code == 404

        devices = c.get("/devices").json()["devices"]
        assert devices == [{"device_id": p["device_id"], "name": "Demo phone", "connected": False,
                            "paired": False, "last_seen": None}]


def test_device_socket_rejects_a_bad_token() -> None:
    with TestClient(_app()) as c:
        p = c.post("/pair").json()
        with c.websocket_connect(f"/ws/device/{p['device_id']}?token=nope") as ws:
            with pytest.raises(Exception):
                ws.receive_json()
        assert c.get("/devices").json()["devices"][0]["connected"] is False


def test_app_approval_flow_and_buzz_reaches_the_phone() -> None:
    with TestClient(_app()) as c:
        p = c.post("/pair").json()
        with c.websocket_connect(f"/ws/device/{p['device_id']}?token={p['device_token']}&name=Ash") as phone:
            assert c.get("/devices").json()["devices"][0] | {"last_seen": 0} == {
                "device_id": p["device_id"], "name": "Ash", "connected": True, "paired": True, "last_seen": 0}

            reg = c.post("/v1/apps", json={"name": "Slide timer"}).json()
            key, app_id = reg["app_key"], reg["app_id"]
            assert reg["status"] == "pending"
            # the phone is told something is waiting
            assert phone.receive_json()["pattern"] == "approve"

            auth = {"Authorization": f"Bearer {key}"}
            assert c.post("/v1/haptics", json={"pattern": "tap"}).status_code == 401
            assert c.post("/v1/haptics", json={"pattern": "tap"},
                          headers={"Authorization": "Bearer wrong"}).status_code == 401
            assert c.post("/v1/haptics", json={"pattern": "tap"}, headers=auth).status_code == 403

            # the phone approves with its device token
            ok = c.post(f"/v1/apps/{app_id}/approve", headers={"X-Device-Token": p["device_token"]})
            assert ok.status_code == 200 and ok.json()["status"] == "approved"
            assert c.get(f"/v1/apps/{app_id}").json()["status"] == "approved"

            assert c.post("/v1/haptics", json={"pattern": "nope"}, headers=auth).status_code == 422
            r = c.post("/v1/haptics", json={"pattern": "wrap_up", "label": "2 minutes left", "intensity": 0.6},
                       headers=auth)
            assert r.status_code == 200 and r.json()["delivered"] == 1
            assert phone.receive_json() == {"type": "haptic", "pattern": "wrap_up", "intensity": 0.6,
                                            "label": "2 minutes left", "source_app": "Slide timer"}

            listed = c.get("/v1/apps").json()["apps"]
            assert listed[0]["buzzes"] == 1 and "app_key" not in listed[0]

            # laptop-only test buzz, no key
            assert c.post("/haptics/test", json={"pattern": "status_good"}).json()["delivered"] == 1
            assert phone.receive_json()["pattern"] == "status_good"

            assert c.delete(f"/v1/apps/{app_id}").json()["status"] == "revoked"
            assert c.post("/v1/haptics", json={"pattern": "tap"}, headers=auth).status_code == 403
        assert c.get("/devices").json()["devices"][0]["connected"] is False


def test_only_the_phone_or_the_laptop_may_approve() -> None:
    app = _app()
    with TestClient(app, client=("203.0.113.9", 5000)) as outsider:
        reg = outsider.post("/v1/apps", json={"name": "Stranger"}).json()
        assert outsider.post(f"/v1/apps/{reg['app_id']}/approve").status_code == 403
        assert outsider.post("/haptics/test", json={"pattern": "tap"}).status_code == 403


# ---------- hub: bus forwarding, dedupe, persistence, rate limit ----------
async def test_nudge_and_status_reply_on_the_bus_reach_the_phone_once() -> None:
    bus, hub = Bus(), Hub()
    hub.attach(bus)
    haptics_port.register_sender(hub.port_sender)
    phone = FakeSocket()
    await hub.connect(hub.create_pairing(), phone)

    nudge = _nudge()
    # the brain does both of these for one buzz: publish on the bus and call the port
    await asyncio.gather(bus.publish(nudge),
                         haptics_port.send(HapticCommand(pattern=nudge.haptic, label=nudge.message)))
    await bus.drain()
    assert [m["pattern"] for m in phone.sent] == ["slow_down"]
    assert phone.sent[0] == {"type": "haptic", "pattern": "slow_down", "intensity": 1.0,
                             "label": "Slow down", "source_app": "undertone"}

    # a nudge that only appears on the bus (fixture replay) is forwarded too
    await bus.publish(_nudge(haptic="filler", message="Pause", rule_id="crutch"))
    await bus.publish(StatusReplyEvent(verdict="talking_too_much", haptic="status_talking", ts=40.0))
    await bus.drain()
    assert [m["pattern"] for m in phone.sent] == ["slow_down", "filler", "status_talking"]


async def test_same_buzz_is_allowed_again_after_the_dedupe_window(monkeypatch: pytest.MonkeyPatch) -> None:
    hub, phone = Hub(), FakeSocket()
    await hub.connect(hub.create_pairing(), phone)
    clock = [100.0]
    monkeypatch.setattr("backend.haptics.hub.time.monotonic", lambda: clock[0])
    cmd = HapticCommand(pattern="filler", label="Pause")
    assert await hub.deliver_once(cmd) == 1
    assert await hub.deliver_once(cmd) == 0
    clock[0] += DEDUPE_S + 0.1
    assert await hub.deliver_once(cmd) == 1


async def test_device_status_and_app_request_are_published() -> None:
    bus, hub = Bus(), Hub()
    hub.attach(bus)
    seen: list[Any] = []

    async def collect(event: Any) -> None:
        seen.append(event)

    bus.on("*", collect)
    device, phone = hub.create_pairing("Ash's iPhone"), FakeSocket()
    await hub.connect(device, phone)
    await hub.register_app("Slide timer")
    await hub.disconnect(device, phone)
    await bus.drain()
    assert [(e.type, getattr(e, "connected", None)) for e in seen] == [
        ("device.status", True), ("app.request", None), ("device.status", False)]
    assert phone.sent[0]["pattern"] == "approve"


async def test_pairings_and_apps_survive_a_restart() -> None:
    kv = FakeKV()
    first = Hub()
    first.attach(None, kv)
    device = first.create_pairing("Ash")
    app = await first.register_app("Slide timer")
    first.set_app_status(app.app_id, "approved")

    second = Hub()
    second.attach(None, kv)
    assert second.device_for_token(device.device_token) is not None
    restored = second.app_for_key(app.app_key)
    assert restored is not None and restored.status == "approved"


async def test_rate_limit_per_app() -> None:
    app = _app()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        reg = (await c.post("/v1/apps", json={"name": "Chatty"})).json()
        await c.post(f"/v1/apps/{reg['app_id']}/approve")
        auth = {"Authorization": f"Bearer {reg['app_key']}"}
        codes = [(await c.post("/v1/haptics", json={"pattern": "tap"}, headers=auth)).status_code
                 for _ in range(RATE_MAX + 1)]
        assert codes[:RATE_MAX] == [200] * RATE_MAX and codes[-1] == 429


def test_mounted_on_the_real_app_uses_the_error_envelope() -> None:
    """What Person B gets after `app.include_router(haptics.router)`."""
    from backend.main import app as real

    already = any(getattr(r, "path", "") == "/v1/haptics" for r in real.router.routes)
    if not already:
        real.include_router(haptics.router)
    try:
        with TestClient(real) as c:
            r = c.post("/v1/haptics", json={"pattern": "tap"})
            assert r.status_code == 401 and r.json()["ok"] is False and r.json()["error"]["code"] == "http_401"
            p = c.post("/pair").json()
            with c.websocket_connect(f"/ws/device/{p['device_id']}?token={p['device_token']}") as phone:
                # a nudge published on the real bus reaches the phone
                assert c.portal is not None
                c.portal.call(real.state.app.bus.publish, _nudge())
                assert phone.receive_json()["pattern"] == "slow_down"
    finally:
        if not already:
            real.router.routes[:] = [r for r in real.router.routes
                                     if getattr(r, "tags", None) != ["haptics"]]
