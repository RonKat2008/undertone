"""HTTP + WebSocket routes for the Haptics Connector. See backend/haptics/__init__.py."""

from __future__ import annotations

import json
import logging
import socket
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from pydantic import BaseModel, Field
from starlette.requests import HTTPConnection

from backend import haptics_port
from backend.config import settings
from backend.contracts import HapticCommand, HapticPattern
from backend.haptics.hub import App, Device, Hub, RateLimited

log = logging.getLogger("undertone.haptics")

router = APIRouter(tags=["haptics"])

LOOPBACK = {"127.0.0.1", "::1", "localhost", "testclient"}
WS_UNAUTHORIZED = 4401


# ---------- hub lifecycle ----------
def install(app: Any, bus: Any = None, kv: Any = None) -> Hub:
    """Create the hub for this app and wire it up. Called lazily by `get_hub`; may be called
    from the lifespan. `bus` / `kv` default to `app.state.app.bus` / `.db` when present."""
    core = getattr(app.state, "app", None)
    bus = bus if bus is not None else getattr(core, "bus", None)
    kv = kv if kv is not None else getattr(core, "db", None)
    hub = Hub()
    hub.attach(bus, kv)
    haptics_port.register_sender(hub.port_sender)
    app.state.haptics = hub
    return hub


def get_hub(conn: HTTPConnection) -> Hub:
    app = conn.app
    hub: Hub | None = getattr(app.state, "haptics", None)
    core = getattr(app.state, "app", None)
    # a new lifespan means a new bus: rebuild so we never publish to a dead one
    if hub is None or (core is not None and hub.bus is not core.bus):
        hub = install(app)
    return hub


# ---------- helpers ----------
def _lan_ip() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # no packet is sent; this only picks the outgoing interface
            ip = s.getsockname()[0]
            return None if ip.startswith("127.") else ip
    except OSError:
        return None


def _server_url(request: Request) -> str:
    """The URL the phone should use. PUBLIC_BACKEND_URL wins when it is a real address."""
    public = settings.public_backend_url
    if public and "localhost" not in public and "127.0.0.1" not in public and "<" not in public:
        return public.rstrip("/")
    host = request.url.hostname or "localhost"
    port = request.url.port or (443 if request.url.scheme == "https" else 80)
    if host in LOOPBACK:
        host = _lan_ip() or host
    return f"{request.url.scheme}://{host}:{port}"


def _bearer(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    scheme, _, value = header.partition(" ")
    return value.strip() if scheme.lower() == "bearer" and value.strip() else None


def _is_local(conn: HTTPConnection) -> bool:
    return conn.client is not None and conn.client.host in LOOPBACK


def _require_owner(request: Request, hub: Hub) -> None:
    """Approving and revoking belongs to the wearer: their phone (device token) or the laptop."""
    token = request.headers.get("x-device-token") or _bearer(request)
    if hub.device_for_token(token) is not None or _is_local(request):
        return
    raise HTTPException(403, "only the paired phone or the laptop can do this")


def _pairing(device: Device, request: Request) -> dict[str, Any]:
    payload = {"server_url": _server_url(request), "device_id": device.device_id,
               "device_token": device.device_token}
    return {**payload, "code": device.code, "name": device.name, "qr": json.dumps(payload, separators=(",", ":"))}


# ---------- bodies ----------
class PairBody(BaseModel):
    name: str | None = None


class ClaimBody(BaseModel):
    code: str
    name: str | None = None


class AppBody(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    origin: str | None = None


class HapticBody(BaseModel):
    pattern: HapticPattern
    intensity: float = Field(default=1.0, ge=0.0, le=1.0)
    label: str = Field(default="", max_length=120)
    device_id: str | None = None


# ---------- pairing and devices ----------
@router.post("/pair")
def pair(request: Request, body: PairBody | None = None, hub: Hub = Depends(get_hub)) -> dict[str, Any]:
    device = hub.create_pairing((body or PairBody()).name)
    return {"ok": True, **_pairing(device, request)}


@router.post("/pair/claim")
def pair_claim(body: ClaimBody, request: Request, hub: Hub = Depends(get_hub)) -> dict[str, Any]:
    device = hub.claim(body.code)
    if device is None:
        raise HTTPException(404, "unknown pairing code")
    if body.name:
        device.name = body.name[:40]
    return {"ok": True, **_pairing(device, request)}


@router.get("/devices")
def devices(hub: Hub = Depends(get_hub)) -> dict[str, Any]:
    return {"ok": True, "devices": hub.list_devices()}


@router.delete("/devices/{device_id}")
async def device_remove(device_id: str, request: Request, hub: Hub = Depends(get_hub)) -> dict[str, Any]:
    _require_owner(request, hub)
    if not await hub.remove_device(device_id):
        raise HTTPException(404, "unknown device")
    return {"ok": True}


@router.websocket("/ws/device/{device_id}")
async def ws_device(websocket: WebSocket, device_id: str, token: str | None = None,
                    name: str | None = None) -> None:
    """The phone holds this open. Server -> phone: HapticCommand JSON. Phone -> server: anything
    (treated as a keep-alive)."""
    hub = get_hub(websocket)
    device = hub.devices.get(device_id)
    await websocket.accept()
    if device is None or hub.device_for_token(token) is not device:
        await websocket.close(code=WS_UNAUTHORIZED, reason="unknown device or bad token")
        return
    await hub.connect(device, websocket, name)
    try:
        while True:
            await websocket.receive_text()
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        await hub.disconnect(device, websocket)


# ---------- third-party apps ----------
@router.post("/v1/apps")
async def app_register(body: AppBody, request: Request, hub: Hub = Depends(get_hub)) -> dict[str, Any]:
    app = await hub.register_app(body.name, body.origin or request.headers.get("origin"))
    return {"ok": True, "app_id": app.app_id, "app_key": app.app_key, "name": app.name, "status": app.status}


@router.get("/v1/apps")
def app_list(hub: Hub = Depends(get_hub)) -> dict[str, Any]:
    return {"ok": True, "apps": hub.list_apps()}


@router.get("/v1/apps/{app_id}")
def app_get(app_id: str, hub: Hub = Depends(get_hub)) -> dict[str, Any]:
    app = hub.apps.get(app_id)
    if app is None:
        raise HTTPException(404, "unknown app")
    return {"ok": True, **app.public()}


@router.post("/v1/apps/{app_id}/approve")
def app_approve(app_id: str, request: Request, hub: Hub = Depends(get_hub)) -> dict[str, Any]:
    _require_owner(request, hub)
    app = hub.set_app_status(app_id, "approved")
    if app is None:
        raise HTTPException(404, "unknown app")
    return {"ok": True, **app.public()}


@router.delete("/v1/apps/{app_id}")
def app_revoke(app_id: str, request: Request, hub: Hub = Depends(get_hub)) -> dict[str, Any]:
    _require_owner(request, hub)
    app = hub.set_app_status(app_id, "revoked")
    if app is None:
        raise HTTPException(404, "unknown app")
    return {"ok": True, **app.public()}


def _app_from_key(request: Request, hub: Hub) -> App:
    app = hub.app_for_key(_bearer(request))
    if app is None:
        raise HTTPException(401, "missing or unknown app key (Authorization: Bearer <app_key>)")
    if app.status == "pending":
        raise HTTPException(403, "waiting for approval on the phone")
    if app.status != "approved":
        raise HTTPException(403, "access revoked")
    return app


@router.post("/v1/haptics")
async def haptics_send(body: HapticBody, request: Request, hub: Hub = Depends(get_hub)) -> dict[str, Any]:
    app = _app_from_key(request, hub)
    if body.device_id is not None and body.device_id not in hub.devices:
        raise HTTPException(404, "unknown device")
    cmd = HapticCommand(pattern=body.pattern, intensity=body.intensity, label=body.label or app.name)
    try:
        delivered = await hub.app_buzz(app, cmd, body.device_id)
    except RateLimited as exc:
        raise HTTPException(429, "too many buzzes; slow down") from exc
    return {"ok": True, "delivered": delivered, "pattern": body.pattern}


@router.post("/haptics/test")
async def haptics_test(body: HapticBody, request: Request, hub: Hub = Depends(get_hub)) -> dict[str, Any]:
    """Buzz from the laptop itself, no app key (scripts/buzz.sh, the dashboard's test button)."""
    _require_owner(request, hub)
    cmd = HapticCommand(pattern=body.pattern, intensity=body.intensity, label=body.label or "test")
    return {"ok": True, "delivered": await hub.deliver(cmd, body.device_id), "pattern": body.pattern}
