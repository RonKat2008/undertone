import asyncio

import pytest

from backend.contracts import HapticCommand, parse_event as validate_event
from backend.db import DB
from backend.haptics.hub import HapticsError, HapticsHub, command, command_for_event

NUDGE = {"type": "nudge", "rule_id": "interrupt", "haptic": "interrupt", "message": "Let them finish", "reason": "r",
         "confidence": 0.9, "latency_ms": 400, "budget_left": 4, "ts": 12.0}
REPLY = {"type": "status.reply", "verdict": "talking_too_much", "haptic": "status_talking", "ts": 42.0}


def run(coro):
    return asyncio.run(coro)


def test_every_nudge_and_status_reply_becomes_a_haptic_command():
    c = command_for_event(NUDGE)
    HapticCommand.model_validate(c)
    assert c == {"type": "haptic", "pattern": "interrupt", "intensity": 1.0, "label": "Let them finish",
                 "source_app": "undertone"}
    r = command_for_event(REPLY)
    assert r["pattern"] == "status_talking" and r["label"] == "Talking too much"
    assert command_for_event({"type": "app.request", "app_id": "a", "name": "Timer"})["pattern"] == "approve"
    assert command_for_event({"type": "metrics"}) is None
    with pytest.raises(HapticsError):
        command("earthquake")
    with pytest.raises(HapticsError):
        command("tap", intensity=3)


def test_pair_attach_fan_out_and_device_status():
    async def go():
        events, got = [], []
        hub = HapticsHub(emit=events.append)
        qr = hub.pair("Ash's iPhone", "http://10.0.0.5:8000/")
        assert set(qr) == {"server_url", "device_id", "device_token"} and qr["server_url"] == "http://10.0.0.5:8000"
        assert hub.list_devices() == [{"type": "device.status", "device_id": qr["device_id"], "name": "Ash's iPhone",
                                       "connected": False}]

        async def send(cmd):
            got.append(cmd)
        with pytest.raises(HapticsError) as e:
            await hub.attach(qr["device_id"], "wrong", send)
        assert e.value.status == 401
        with pytest.raises(HapticsError):
            await hub.attach("d_nope", qr["device_token"], send)
        await hub.attach(qr["device_id"], qr["device_token"], send)
        assert events[-1]["connected"] is True and hub.list_devices()[0]["connected"]
        await hub.on_bus_event(NUDGE)
        await hub.on_bus_event(REPLY)
        await hub.on_bus_event({"type": "metrics"})
        assert [c["pattern"] for c in got] == ["interrupt", "status_talking"]
        await hub.detach(qr["device_id"], send)
        assert events[-1]["connected"] is False
        for ev in events:
            validate_event(ev)
        assert await hub.send_all(command("tap")) == 0
    run(go())


def test_a_dead_socket_is_dropped_not_fatal():
    async def go():
        hub = HapticsHub()
        qr = hub.pair("p", "http://x")

        async def dead(cmd):
            raise ConnectionError()
        await hub.attach(qr["device_id"], qr["device_token"], dead)
        assert await hub.send_all(command("tap")) == 0 and not hub.connected(qr["device_id"])
    run(go())


def test_app_register_approve_buzz_delete():
    async def go():
        events, got = [], []
        hub = HapticsHub(emit=events.append)
        qr = hub.pair("p", "http://x")

        async def send(cmd):
            got.append(cmd)
        await hub.attach(qr["device_id"], qr["device_token"], send)
        app = await hub.register_app("Slide timer")
        assert events[-1] == {"type": "app.request", "app_id": app["app_id"], "name": "Slide timer"}
        validate_event(events[-1])
        await hub.on_bus_event(events[-1])
        assert got[-1]["pattern"] == "approve"
        bearer = "Bearer " + app["app_key"]
        for bad, status in ((None, 401), ("Bearer nope", 401), (bearer, 403)):      # 403: not approved yet
            with pytest.raises(HapticsError) as e:
                await hub.buzz_from_app(bad, "tap")
            assert e.value.status == status
        assert hub.approve(app["app_id"])["approved"] and hub.list_apps()[0]["approved"]
        assert "key" not in hub.list_apps()[0] and "app_key" not in hub.list_apps()[0]
        assert await hub.buzz_from_app(bearer, "wrap_up", 0.4, "2 minutes left") == 1
        assert got[-1] == {"type": "haptic", "pattern": "wrap_up", "intensity": 0.4, "label": "2 minutes left",
                           "source_app": "Slide timer"}
        with pytest.raises(HapticsError) as e:
            await hub.buzz_from_app(bearer, "nope")
        assert e.value.status == 400
        hub.delete_app(app["app_id"])
        with pytest.raises(HapticsError) as e:
            await hub.buzz_from_app(bearer, "tap")
        assert e.value.status == 401
        for fn in (lambda: hub.approve("app_x"), lambda: hub.delete_app("app_x")):
            with pytest.raises(HapticsError) as e:
                fn()
            assert e.value.status == 404
        with pytest.raises(HapticsError):
            await hub.register_app("  ")
        with pytest.raises(HapticsError):
            await hub.register_app("Undertone")
    run(go())


def test_registry_survives_a_restart():
    async def go():
        db = DB(":memory:")
        hub = HapticsHub(store=db)
        qr = hub.pair("p", "http://x")
        app = await hub.register_app("Timer")
        hub.approve(app["app_id"])
        again = HapticsHub(store=db)
        assert again.device_ok(qr["device_id"], qr["device_token"])
        assert again.device_for_token(qr["device_token"]) == qr["device_id"] and again.device_for_token("x") is None
        assert again.app_for_key(app["app_key"])["name"] == "Timer"
    run(go())


def test_attach_haptics_routes_the_brain_port_to_phones(tmp_path):
    from backend import haptics_port
    from backend.bus import Bus
    from backend.haptics import attach_haptics
    from types import SimpleNamespace

    async def go():
        db = DB(str(tmp_path / "h.db"))
        state = SimpleNamespace(bus=Bus(), db=db)
        hub = attach_haptics(state)
        qr = hub.pair("iPhone", "http://x")
        got = []

        async def send(cmd):
            got.append(cmd)

        await hub.attach(qr["device_id"], qr["device_token"], send)
        await haptics_port.send(HapticCommand(pattern="wrap_up", label="Ask a question"))
        haptics_port.reset_sender()
        db.close()
        return got

    got = run(go())
    assert got and got[-1]["pattern"] == "wrap_up" and got[-1]["source_app"] == "undertone"
