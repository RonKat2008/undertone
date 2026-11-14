"""Haptics Connector routes (plan.md 4.8, 4.11). In backend/main.py:

    from backend.haptics import attach_haptics, build_router as haptics_router
    hub = attach_haptics(state)                 # in lifespan, after the Bus and DB exist
    app.include_router(haptics_router(hub))     # routes call the hub through app.state

  POST   /pair                      {name?}                 -> {server_url, device_id, device_token}  (the QR payload)
  GET    /devices                                           -> [device.status rows]
  WS     /ws/device/{device_id}?token=<device_token>        -> HapticCommand JSON messages
                                    (or send {"token": "..."} as the first message instead of the query)
  POST   /v1/apps                   {name}                  -> {app_id, app_key, name, approved:false}; emits app.request
  GET    /v1/apps                                           -> [{app_id, name, approved}]  (for the phone's Connected apps)
  POST   /v1/apps/{id}/approve      Bearer <device_token>   -> {app_id, name, approved:true}
  DELETE /v1/apps/{id}              Bearer <device_token>
  POST   /v1/haptics                Bearer <app_key>, {pattern, intensity?, label?}  -> {ok, delivered}

Approve and delete need a paired phone's token, so a web page cannot approve itself (not even
one open on the laptop).
"""
import asyncio
import json
import os
from typing import Optional

from .hub import HapticsError, HapticsHub


def server_url(request=None) -> str:
    base = (os.getenv("PUBLIC_BACKEND_URL") or "").strip().rstrip("/")
    if base and "<" not in base:
        return base
    return str(request.base_url).rstrip("/") if request is not None else "http://localhost:8000"


def build_router(hub: HapticsHub):
    from fastapi import APIRouter, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
    from pydantic import BaseModel

    r = APIRouter()

    class PairIn(BaseModel):
        name: Optional[str] = None

    class AppIn(BaseModel):
        name: str

    class BuzzIn(BaseModel):
        pattern: str
        intensity: Optional[float] = None
        label: str = ""

    def fail(e: HapticsError):
        raise HTTPException(e.status, e.message)

    def owner(request: Request, authorization: Optional[str]) -> None:
        token = (authorization or "").strip()
        if token.lower().startswith("bearer "):
            token = token[7:].strip()
        if not hub.device_for_token(token):
            raise HTTPException(401, "needs a paired phone: Authorization: Bearer <device_token>")

    @r.post("/pair")
    async def pair(request: Request, body: PairIn = PairIn()):
        return hub.pair(body.name or "iPhone", server_url(request))

    @r.get("/devices")
    async def devices():
        return hub.list_devices()

    @r.websocket("/ws/device/{device_id}")
    async def device_ws(ws: WebSocket, device_id: str):
        await ws.accept()
        token = ws.query_params.get("token")
        if not token:
            try:
                first = await asyncio.wait_for(ws.receive_text(), 5)
                token = json.loads(first).get("token")
            except Exception:  # noqa: BLE001
                token = None

        async def send(cmd: dict) -> None:
            await ws.send_json(cmd)
        try:
            await hub.attach(device_id, token, send)
        except HapticsError:
            await ws.close(code=4401)
            return
        try:
            while True:
                await ws.receive_text()          # the phone only listens; this notices the disconnect
        except WebSocketDisconnect:
            pass
        finally:
            await hub.detach(device_id, send)

    @r.post("/v1/apps")
    async def register(body: AppIn):
        try:
            return await hub.register_app(body.name)
        except HapticsError as e:
            fail(e)

    @r.get("/v1/apps")
    async def apps():
        return hub.list_apps()

    @r.post("/v1/apps/{app_id}/approve")
    async def approve(app_id: str, request: Request, authorization: Optional[str] = Header(None)):
        owner(request, authorization)
        try:
            return hub.approve(app_id)
        except HapticsError as e:
            fail(e)

    @r.delete("/v1/apps/{app_id}")
    async def delete(app_id: str, request: Request, authorization: Optional[str] = Header(None)):
        owner(request, authorization)
        try:
            hub.delete_app(app_id)
        except HapticsError as e:
            fail(e)
        return {"ok": True}

    @r.post("/v1/haptics")
    async def buzz(body: BuzzIn, authorization: Optional[str] = Header(None)):
        try:
            n = await hub.buzz_from_app(authorization, body.pattern, body.intensity, body.label)
        except HapticsError as e:
            fail(e)
        return {"ok": True, "delivered": n}

    return r
