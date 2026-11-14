"""Haptics Connector (plan.md 4.8, 4.11). Owner: Person C.

Mounting (Person B, in backend/main.py):

    from backend import haptics
    app.include_router(haptics.router)

That is enough: the hub attaches itself to `app.state.app` (bus + db) on the first request
and registers itself with `backend.haptics_port`. To attach eagerly at startup instead, call
`haptics.install(app)` inside the lifespan after `app.state.app` is set.

Routes:
    POST   /pair                      new pairing -> {server_url, device_id, device_token, code, qr}
    POST   /pair/claim {code}         phone typed the short code -> same payload
    GET    /devices                   paired phones with live status
    DELETE /devices/{device_id}
    WS     /ws/device/{device_id}?token=...   phone connection; server sends HapticCommand JSON
    POST   /v1/apps {name}            third-party app asks for access -> {app_id, app_key, status}
    GET    /v1/apps                   list (no keys)      GET /v1/apps/{id} -> status
    POST   /v1/apps/{id}/approve      phone (device token) or the laptop itself
    DELETE /v1/apps/{id}              revoke
    POST   /v1/haptics                Authorization: Bearer <app_key>, body {pattern, intensity?, label?}
    POST   /haptics/test              laptop only: buzz without an app key (scripts/buzz.sh)
"""

from backend.haptics.hub import App, Device, Hub
from backend.haptics.routes import get_hub, install, router

__all__ = ["App", "Device", "Hub", "get_hub", "install", "router"]
