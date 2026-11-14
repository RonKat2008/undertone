"""FastAPI dependencies shared by package routers. Routers must not import backend.main."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import HTTPException, Request

from backend.state import AppState

if TYPE_CHECKING:
    from backend.brain import Brain


def get_app_state(request: Request) -> AppState:
    st = getattr(request.app.state, "app", None)
    if st is None:
        raise HTTPException(503, "app not ready")
    return st


def get_brain(request: Request) -> "Brain":
    brain = getattr(request.app.state, "brain", None)
    if brain is None:
        raise HTTPException(503, "brain not ready")
    return brain
