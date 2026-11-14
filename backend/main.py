"""FastAPI app. Run: uv run uvicorn backend.main:app --port 8000

Only Person B edits this file. Other packages hand over an APIRouter to include.
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from backend import debrief, growth, studio
from backend.brain import Brain
from backend.bus import Bus, to_wire
from backend.config import MEDIA_DIR, settings
from backend.contracts import BookmarkSource, SessionMode, parse_event
from backend.db import DB
from backend.deps import get_app_state, get_brain
from backend.state import AppState

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("undertone.main")


def _initial_coach(db: DB):  # type: ignore[no-untyped-def]
    active_id = db.kv_get("active_coach_id")
    if active_id:
        found = db.load_coach(active_id) or next((c for c in studio.load_prebuilt() if c.id == active_id), None)
        if found is not None:
            return found
    return studio.default_coach()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    db = DB(settings.db_path)
    state = AppState(bus=Bus(), db=db, active_coach=_initial_coach(db))
    app.state.app = state
    app.state.brain = Brain(state, settings)
    log.info("undertone up: %s", settings)
    try:
        yield
    finally:
        brain: Brain = app.state.brain
        if state.session is not None:
            try:
                await brain.end_session()
            except Exception:
                log.exception("end_session on shutdown failed")
        await state.bus.drain()
        db.close()


app = FastAPI(title="Undertone", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
MEDIA_DIR.mkdir(exist_ok=True)
app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")
app.include_router(studio.router)
app.include_router(growth.router)
app.include_router(debrief.router)


# ---------- error envelope: {"ok": false, "error": {"code", "message", "details"?}} ----------
def _err(status: int, code: str, message: str, details: Any = None) -> JSONResponse:
    body: dict[str, Any] = {"ok": False, "error": {"code": code, "message": message}}
    if details is not None:
        body["error"]["details"] = details
    return JSONResponse(body, status_code=status)


@app.exception_handler(StarletteHTTPException)
async def _http_exc(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    return _err(exc.status_code, f"http_{exc.status_code}", str(exc.detail))


@app.exception_handler(RequestValidationError)
async def _req_validation(_: Request, exc: RequestValidationError) -> JSONResponse:
    return _err(422, "invalid_request", "request body failed validation", jsonable(exc.errors()))


@app.exception_handler(ValidationError)
async def _validation(_: Request, exc: ValidationError) -> JSONResponse:
    return _err(422, "invalid_event", "event failed contract validation", jsonable(exc.errors()))


@app.exception_handler(Exception)
async def _unhandled(_: Request, exc: Exception) -> JSONResponse:
    log.exception("unhandled error")
    return _err(500, "internal", type(exc).__name__)


def jsonable(errors: Any) -> Any:
    from fastapi.encoders import jsonable_encoder

    return jsonable_encoder(errors, custom_encoder={Exception: str})


# ---------- routes ----------
class StartBody(BaseModel):
    coach_id: str | None = None
    mode: SessionMode = "regular"


class BookmarkBody(BaseModel):
    text: str | None = None
    source: BookmarkSource = "phone"


@app.get("/health")
def health(st: AppState = Depends(get_app_state)) -> dict[str, Any]:
    return {"ok": True, "session_id": st.session.session_id if st.session else None,
            "active_coach": st.active_coach.id, "subscribers": st.bus.subscriber_count,
            "gemini": settings.has_gemini, "deepgram": settings.has_deepgram,
            "rule_judge_only": settings.use_rule_judge_only, "demo_policy": settings.demo_policy,
            "dev": settings.dev}


@app.post("/session/start")
async def session_start(body: StartBody | None = None, brain: Brain = Depends(get_brain)) -> dict[str, Any]:
    body = body or StartBody()
    try:
        sid = await brain.start_session(body.coach_id, body.mode)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"ok": True, "session_id": sid}


@app.post("/session/stop")
async def session_stop(brain: Brain = Depends(get_brain)) -> dict[str, Any]:
    event = await brain.end_session()
    if event is None:
        raise HTTPException(409, "no session running (or debrief failed; see server log)")
    return {"ok": True, "session_id": event.session_id, "debrief": to_wire(event)}


@app.post("/session/bookmark")
async def session_bookmark(body: BookmarkBody | None = None, brain: Brain = Depends(get_brain)) -> dict[str, Any]:
    body = body or BookmarkBody()
    event = await brain.bookmark(body.source, body.text)
    if event is None:
        raise HTTPException(409, "no session running")
    return {"ok": True, "bookmark": to_wire(event)}


@app.post("/session/tap")
async def session_tap(brain: Brain = Depends(get_brain)) -> dict[str, Any]:
    reply = await brain.single_tap()
    if reply is None:
        raise HTTPException(409, "no session running")
    return {"ok": True, "status": to_wire(reply)}


@app.post("/dev/publish", include_in_schema=settings.dev)
async def dev_publish(event: dict[str, Any], st: AppState = Depends(get_app_state)) -> dict[str, Any]:
    """DEV=1 only: inject one bus event (validated against the contract)."""
    if not settings.dev:
        raise HTTPException(404, "Not Found")
    model = await st.bus.publish(parse_event(event))
    return {"ok": True, "type": model.type}  # type: ignore[attr-defined]


@app.websocket("/ws")
async def ws(websocket: WebSocket) -> None:
    st: AppState = websocket.app.state.app
    await websocket.accept()
    stream = st.bus.subscribe()
    try:
        async for event in stream:
            await websocket.send_json(to_wire(event))
    except (WebSocketDisconnect, RuntimeError, asyncio.CancelledError):
        pass
    finally:
        await stream.aclose()
