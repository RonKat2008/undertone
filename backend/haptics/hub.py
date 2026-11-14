"""Haptics hub: paired phones, third-party apps, and delivery of HapticCommands.

State lives in memory and (when a DB is attached) in the kv table under `haptics.devices` /
`haptics.apps`, so a phone stays paired across a backend restart.

Delivery paths, all ending in `Hub.deliver`:
- the brain calls `haptics_port.send` for every buzzed nudge and every tap reply;
- `nudge` / `status.reply` events seen on the bus (e.g. injected by scripts/replay.py);
- `POST /v1/haptics` from an approved third-party app.
The first two describe the same buzz, so `deliver_once` drops a repeat inside DEDUPE_S.
"""

from __future__ import annotations

import logging
import secrets
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Literal, Protocol

from backend.contracts import AppRequestEvent, DeviceStatusEvent, HapticCommand

log = logging.getLogger("undertone.haptics")

DEDUPE_S = 1.5
RATE_WINDOW_S = 10.0
RATE_MAX = 30  # buzzes per app per window
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no 0/O/1/I
KV_DEVICES = "haptics.devices"
KV_APPS = "haptics.apps"

AppStatus = Literal["pending", "approved", "revoked"]


class Socket(Protocol):
    async def send_json(self, data: Any) -> None: ...


class KV(Protocol):
    def kv_get(self, key: str, default: Any = None) -> Any: ...
    def kv_set(self, key: str, value: Any) -> None: ...


@dataclass
class Device:
    device_id: str
    device_token: str
    code: str
    name: str = "iPhone"
    created_at: float = field(default_factory=time.time)
    last_seen: float | None = None

    def public(self, connected: bool) -> dict[str, Any]:
        return {"device_id": self.device_id, "name": self.name, "connected": connected,
                "paired": self.last_seen is not None, "last_seen": self.last_seen}


@dataclass
class App:
    app_id: str
    app_key: str
    name: str
    origin: str | None = None
    status: AppStatus = "pending"
    created_at: float = field(default_factory=time.time)
    last_used: float | None = None
    buzzes: int = 0

    def public(self) -> dict[str, Any]:
        return {"app_id": self.app_id, "name": self.name, "origin": self.origin, "status": self.status,
                "created_at": self.created_at, "last_used": self.last_used, "buzzes": self.buzzes}


class RateLimited(Exception):
    pass


class Hub:
    def __init__(self) -> None:
        self.devices: dict[str, Device] = {}
        self.apps: dict[str, App] = {}
        self.bus: Any = None
        self._kv: KV | None = None
        self._sockets: dict[str, set[Socket]] = {}
        self._recent: dict[tuple[str, str], float] = {}
        self._rate: dict[str, list[float]] = {}

    # ---------- wiring ----------
    def attach(self, bus: Any = None, kv: KV | None = None) -> None:
        """Connect to the event bus and the kv store. Safe to call with neither (tests)."""
        self.bus, self._kv = bus, kv
        if kv is not None:
            try:
                self.devices = {d["device_id"]: Device(**d) for d in kv.kv_get(KV_DEVICES, []) or []}
                self.apps = {a["app_id"]: App(**a) for a in kv.kv_get(KV_APPS, []) or []}
            except Exception:
                log.exception("could not load saved haptics state; starting empty")
        if bus is not None:
            bus.on("nudge", self._on_nudge)
            bus.on("status.reply", self._on_status_reply)

    def _save(self) -> None:
        if self._kv is None:
            return
        try:
            self._kv.kv_set(KV_DEVICES, [asdict(d) for d in self.devices.values()])
            self._kv.kv_set(KV_APPS, [asdict(a) for a in self.apps.values()])
        except Exception:
            log.exception("could not save haptics state")

    async def _publish(self, event: Any) -> None:
        if self.bus is None:
            return
        try:
            await self.bus.publish(event)
        except Exception:
            log.exception("bus publish failed: %s", getattr(event, "type", "?"))

    # ---------- devices ----------
    def create_pairing(self, name: str | None = None) -> Device:
        code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
        device = Device(device_id=f"d-{secrets.token_hex(4)}", device_token=secrets.token_urlsafe(24),
                        code=code, name=name or "iPhone")
        self.devices[device.device_id] = device
        self._save()
        return device

    def claim(self, code: str) -> Device | None:
        wanted = code.strip().upper().replace("-", "").replace(" ", "")
        matches = [d for d in self.devices.values() if d.code == wanted]
        return max(matches, key=lambda d: d.created_at) if matches else None

    def device_for_token(self, token: str | None) -> Device | None:
        if not token:
            return None
        return next((d for d in self.devices.values() if secrets.compare_digest(d.device_token, token)), None)

    def is_connected(self, device_id: str) -> bool:
        return bool(self._sockets.get(device_id))

    def list_devices(self) -> list[dict[str, Any]]:
        return [d.public(self.is_connected(d.device_id))
                for d in sorted(self.devices.values(), key=lambda d: d.created_at)]

    async def remove_device(self, device_id: str) -> bool:
        device = self.devices.pop(device_id, None)
        if device is None:
            return False
        for ws in list(self._sockets.pop(device_id, set())):
            close = getattr(ws, "close", None)
            if close is not None:
                try:
                    await close(code=4401)
                except Exception:
                    pass
        self._save()
        await self._publish(DeviceStatusEvent(device_id=device_id, name=device.name, connected=False))
        return True

    async def connect(self, device: Device, ws: Socket, name: str | None = None) -> None:
        if name:
            device.name = name[:40]
        device.last_seen = time.time()
        self._sockets.setdefault(device.device_id, set()).add(ws)
        self._save()
        await self._publish(DeviceStatusEvent(device_id=device.device_id, name=device.name, connected=True))

    async def disconnect(self, device: Device, ws: Socket) -> None:
        sockets = self._sockets.get(device.device_id, set())
        sockets.discard(ws)
        device.last_seen = time.time()
        if not sockets and device.device_id in self.devices:
            await self._publish(DeviceStatusEvent(device_id=device.device_id, name=device.name, connected=False))

    # ---------- delivery ----------
    async def deliver(self, cmd: HapticCommand, device_id: str | None = None) -> int:
        """Send to one phone, or to every connected phone. Returns how many sockets got it."""
        payload = cmd.model_dump(mode="json")
        targets = [device_id] if device_id else list(self._sockets)
        sent = 0
        for did in targets:
            for ws in list(self._sockets.get(did, set())):
                try:
                    await ws.send_json(payload)
                    sent += 1
                except Exception:
                    log.info("dropping dead socket for %s", did)
                    self._sockets.get(did, set()).discard(ws)
        log.info("haptic %s (%s) from %s -> %d phone(s)", cmd.pattern, cmd.label, cmd.source_app, sent)
        return sent

    async def deliver_once(self, cmd: HapticCommand) -> int:
        """Deliver unless the same pattern + label went out a moment ago (brain and bus overlap)."""
        now = time.monotonic()
        key = (cmd.pattern, cmd.label)
        self._recent = {k: t for k, t in self._recent.items() if now - t < DEDUPE_S}
        if key in self._recent:
            return 0
        self._recent[key] = now
        return await self.deliver(cmd)

    async def port_sender(self, cmd: HapticCommand) -> None:
        """Registered with backend.haptics_port: the brain's buzzes arrive here."""
        await self.deliver_once(cmd)

    async def _on_nudge(self, event: Any) -> None:
        await self.deliver_once(HapticCommand(pattern=event.haptic, label=event.message))

    async def _on_status_reply(self, event: Any) -> None:
        await self.deliver_once(HapticCommand(pattern=event.haptic, label=event.verdict))

    # ---------- third-party apps ----------
    async def register_app(self, name: str, origin: str | None = None) -> App:
        app = App(app_id=f"app-{secrets.token_hex(4)}", app_key=f"ut_{secrets.token_urlsafe(24)}",
                  name=name.strip()[:60] or "Unnamed app", origin=origin)
        self.apps[app.app_id] = app
        self._save()
        await self._publish(AppRequestEvent(app_id=app.app_id, name=app.name))
        # the phone taps twice: something is waiting for approval
        await self.deliver(HapticCommand(pattern="approve", label=f"{app.name} wants to buzz you",
                                         source_app="undertone"))
        return app

    def app_for_key(self, key: str | None) -> App | None:
        if not key:
            return None
        return next((a for a in self.apps.values() if secrets.compare_digest(a.app_key, key)), None)

    def set_app_status(self, app_id: str, status: AppStatus) -> App | None:
        app = self.apps.get(app_id)
        if app is None:
            return None
        app.status = status
        self._save()
        return app

    def remove_app(self, app_id: str) -> bool:
        removed = self.apps.pop(app_id, None) is not None
        if removed:
            self._save()
        return removed

    def list_apps(self) -> list[dict[str, Any]]:
        return [a.public() for a in sorted(self.apps.values(), key=lambda a: a.created_at)]

    async def app_buzz(self, app: App, cmd: HapticCommand, device_id: str | None = None) -> int:
        now = time.monotonic()
        stamps = [t for t in self._rate.get(app.app_id, []) if now - t < RATE_WINDOW_S]
        if len(stamps) >= RATE_MAX:
            self._rate[app.app_id] = stamps
            raise RateLimited(app.app_id)
        self._rate[app.app_id] = [*stamps, now]
        app.last_used = time.time()
        app.buzzes += 1
        self._save()
        return await self.deliver(cmd.model_copy(update={"source_app": app.name}), device_id)
