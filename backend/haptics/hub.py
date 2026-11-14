"""Haptics Connector core (plan.md 4.8): paired phones, third-party apps, and the fan-out of
HapticCommands. No web framework here; router.py wraps it.

    hub = attach_haptics(state)        # in main.py's lifespan: wires the Brain's haptics_port to the phones
    qr = hub.pair("Ash's iPhone", "http://10.0.0.5:8000")       -> {server_url, device_id, device_token}
    hub.attach(device_id, token, send)                  # phone's WebSocket; send(dict) is async
    await hub.on_bus_event(ev)                          # nudge / status.reply / app.request -> HapticCommand
    app = hub.register_app("Slide timer")               -> {app_id, app_key, name, approved}
    hub.approve(app_id); hub.delete_app(app_id)
    await hub.buzz_from_app(bearer, pattern, intensity, label)  -> number of phones reached

The phone is the haptic output: the band has no motor and iOS Safari cannot vibrate.
Tokens and app keys are random, compared in constant time, and never logged.
"""
from __future__ import annotations

import asyncio
import hmac
import logging
import secrets
from typing import Any, Awaitable, Callable, Dict, List, Optional

from backend.contracts import HAPTIC_PATTERNS, HapticCommand

log = logging.getLogger("undertone.haptics")
Send = Callable[[dict], Awaitable[None]]
KV_KEY = "haptics"
INTENSITY = {"success": 0.7, "tap": 0.5, "approve": 0.6, "filler": 0.8, "still": 0.6, "slow_down": 0.7}


class HapticsError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def command(pattern: str, label: str = "", intensity: Optional[float] = None, source_app: str = "undertone") -> dict:
    """A contract HapticCommand dict. Raises HapticsError(400) on an unknown pattern or bad intensity."""
    if pattern not in HAPTIC_PATTERNS:
        raise HapticsError(400, "unknown pattern %r (known: %s)" % (pattern, ", ".join(sorted(HAPTIC_PATTERNS))))
    if intensity is None:
        intensity = INTENSITY.get(pattern, 1.0)
    try:
        intensity = float(intensity)
    except (TypeError, ValueError):
        raise HapticsError(400, "intensity must be a number from 0 to 1")
    if not 0 <= intensity <= 1:
        raise HapticsError(400, "intensity must be from 0 to 1")
    cmd = {"type": "haptic", "pattern": pattern, "intensity": intensity, "label": str(label or "")[:120],
           "source_app": source_app}
    HapticCommand.model_validate(cmd)
    return cmd


def command_for_event(ev: dict) -> Optional[dict]:
    """Which bus events buzz the phone: every nudge and every status.reply, plus a tick when a
    third-party app is waiting for approval."""
    t = ev.get("type")
    if t == "nudge":
        return command(ev["haptic"], ev["message"])
    if t == "status.reply":
        label = {"good": "Good", "talking_too_much": "Talking too much", "ask_question": "Ask a question"}
        return command(ev["haptic"], label.get(ev["verdict"], ""), 1.0)
    if t == "app.request":
        return command("approve", "%s wants to buzz this phone" % ev["name"])
    return None


class HapticsHub:
    def __init__(self, emit: Optional[Callable[[dict], Any]] = None, store: Any = None) -> None:
        self.emit = emit
        self.store = store
        self.devices: Dict[str, dict] = {}       # device_id -> {name, token}
        self.apps: Dict[str, dict] = {}          # app_id -> {name, key, approved}
        self._conns: Dict[str, List[Send]] = {}
        self.sent: List[dict] = []               # last commands, for tests and the replay script
        if store is not None:
            saved = store.kv_get(KV_KEY) or {}
            self.devices = saved.get("devices", {})
            self.apps = saved.get("apps", {})

    def _save(self) -> None:
        if self.store is not None:
            self.store.kv_set(KV_KEY, {"devices": self.devices, "apps": self.apps})

    async def _emit(self, ev: dict) -> None:
        if self.emit is None:
            return
        r = self.emit(ev)
        if asyncio.iscoroutine(r):
            await r

    # ---------- devices ----------

    def pair(self, name: str, server_url: str) -> dict:
        """New phone. The return value is the QR payload."""
        device_id = "d_" + secrets.token_hex(4)
        token = secrets.token_urlsafe(24)
        self.devices[device_id] = {"name": (name or "iPhone").strip()[:60] or "iPhone", "token": token}
        self._save()
        return {"server_url": server_url.rstrip("/"), "device_id": device_id, "device_token": token}

    def device_ok(self, device_id: str, token: Optional[str]) -> bool:
        d = self.devices.get(device_id)
        return bool(d and token and hmac.compare_digest(d["token"], token))

    def device_for_token(self, token: Optional[str]) -> Optional[str]:
        if not token:
            return None
        return next((i for i, d in self.devices.items() if hmac.compare_digest(d["token"], token)), None)

    def connected(self, device_id: str) -> bool:
        return bool(self._conns.get(device_id))

    def list_devices(self) -> List[dict]:
        """`device.status` shaped rows (no tokens)."""
        return [{"type": "device.status", "device_id": i, "name": d["name"], "connected": self.connected(i)}
                for i, d in self.devices.items()]

    async def attach(self, device_id: str, token: Optional[str], send: Send) -> None:
        if not self.device_ok(device_id, token):
            raise HapticsError(401, "unknown device or wrong token")
        self._conns.setdefault(device_id, []).append(send)
        await self._emit({"type": "device.status", "device_id": device_id, "name": self.devices[device_id]["name"],
                          "connected": True})

    async def detach(self, device_id: str, send: Send) -> None:
        conns = self._conns.get(device_id, [])
        if send in conns:
            conns.remove(send)
        if device_id in self.devices:
            await self._emit({"type": "device.status", "device_id": device_id, "name": self.devices[device_id]["name"],
                              "connected": self.connected(device_id)})

    async def send_all(self, cmd: dict) -> int:
        """Send one HapticCommand to every connected phone. Returns how many got it."""
        self.sent.append(cmd)
        del self.sent[:-200]
        n = 0
        for device_id, conns in list(self._conns.items()):
            for send in list(conns):
                try:
                    await send(cmd)
                    n += 1
                except Exception:  # noqa: BLE001
                    await self.detach(device_id, send)
        return n

    async def on_bus_event(self, ev: dict) -> None:
        cmd = command_for_event(ev)
        if cmd is not None:
            await self.send_all(cmd)

    # ---------- third-party apps ----------

    async def register_app(self, name: str) -> dict:
        name = (name or "").strip()[:60]
        if not name:
            raise HapticsError(400, "name is required")
        if name.lower() == "undertone":
            raise HapticsError(400, "that name is reserved")
        app_id = "app_" + secrets.token_hex(4)
        key = "ut_" + secrets.token_urlsafe(24)
        self.apps[app_id] = {"name": name, "key": key, "approved": False}
        self._save()
        await self._emit({"type": "app.request", "app_id": app_id, "name": name})
        await self.send_all(command("approve", "%s wants to buzz this phone" % name))
        return {"app_id": app_id, "app_key": key, "name": name, "approved": False}

    def list_apps(self) -> List[dict]:
        return [{"app_id": i, "name": a["name"], "approved": a["approved"]} for i, a in self.apps.items()]

    def approve(self, app_id: str) -> dict:
        a = self.apps.get(app_id)
        if a is None:
            raise HapticsError(404, "unknown app")
        a["approved"] = True
        self._save()
        return {"app_id": app_id, "name": a["name"], "approved": True}

    def delete_app(self, app_id: str) -> None:
        if self.apps.pop(app_id, None) is None:
            raise HapticsError(404, "unknown app")
        self._save()

    def app_for_key(self, bearer: Optional[str]) -> dict:
        """`bearer` is the Authorization header value or the bare key."""
        key = (bearer or "").strip()
        if key.lower().startswith("bearer "):
            key = key[7:].strip()
        if not key:
            raise HapticsError(401, "missing Authorization: Bearer <app_key>")
        for app_id, a in self.apps.items():
            if hmac.compare_digest(a["key"], key):
                if not a["approved"]:
                    raise HapticsError(403, "waiting for approval on the phone")
                return dict(a, app_id=app_id)
        raise HapticsError(401, "unknown app key")

    async def buzz_from_app(self, bearer: Optional[str], pattern: str, intensity: Optional[float] = None,
                            label: str = "") -> int:
        app = self.app_for_key(bearer)
        return await self.send_all(command(pattern, label, intensity, source_app=app["name"]))


def attach_haptics(app_state) -> HapticsHub:
    """Register the hub as the Brain's haptics sender (backend/haptics_port.py). The Brain
    already sends every nudge and status reply through the port, so the hub does not listen
    to the bus for those (that would buzz twice)."""
    from backend import haptics_port

    hub = HapticsHub(emit=app_state.bus.publish, store=app_state.db)

    async def sender(cmd: HapticCommand) -> None:
        await hub.send_all(cmd.model_dump(mode="json"))

    haptics_port.register_sender(sender)
    return hub
