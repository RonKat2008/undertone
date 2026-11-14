"""Knowledge graph routes. Thin: load rows, call the pure builders, never call the LLM inline."""

from __future__ import annotations

import time

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.contracts import CommitmentStatus, CommitmentUpdate, GraphNodeDetail, KnowledgeGraph
from backend.deps import get_app_state
from backend.graph._build import build_graph, cap_graph
from backend.graph._cache import missing_sessions
from backend.graph._commitments import is_promise, parse_commitment_id, set_manual
from backend.graph._detail import node_detail
from backend.graph._load import load_input
from backend.graph._refresh import MAX_PER_RUN, needs_refresh, refresh_all, refresh_lazily
from backend.graph._rows import CommitmentState
from backend.state import AppState

router = APIRouter(tags=["graph"])

DEFAULT_DAYS = 30
MAX_DAYS = 365


class GraphRefresh(BaseModel):
    refreshed: int  # sessions whose topics were extracted in this call
    remaining: int  # finished sessions still without cached topics
    labels_consolidated: int = 0  # topic labels given a stored canonical in this call
    commitments_closed: int = 0  # promises closed automatically in this call


@router.get("/graph", response_model=KnowledgeGraph)
def get_graph(background: BackgroundTasks, days: int = Query(DEFAULT_DAYS, ge=1, le=MAX_DAYS),
              st: AppState = Depends(get_app_state)) -> KnowledgeGraph:
    """The real graph for the window. An empty database gives just the `me` node and zero stats."""
    now = time.time()
    inp = load_input(st.db, days, now)
    if inp.has_any_session and needs_refresh(st.db):
        background.add_task(refresh_lazily, st.db)
    return cap_graph(build_graph(inp, now))


@router.get("/graph/node/{node_id:path}", response_model=GraphNodeDetail)
def get_node(node_id: str, days: int = Query(DEFAULT_DAYS, ge=1, le=MAX_DAYS),
             st: AppState = Depends(get_app_state)) -> GraphNodeDetail:
    now = time.time()
    inp = load_input(st.db, days, now)
    detail = node_detail(inp, build_graph(inp, now), node_id)
    if detail is None:
        raise HTTPException(404, f"graph node {node_id} not found")
    return detail


@router.post("/graph/refresh", response_model=GraphRefresh)
async def refresh(st: AppState = Depends(get_app_state)) -> GraphRefresh:
    result = await refresh_all(st.db, MAX_PER_RUN)
    return GraphRefresh(refreshed=result.sessions, remaining=len(missing_sessions(st.db, 10_000)),
                        labels_consolidated=result.labels, commitments_closed=result.closed)


def commitment_status(state: CommitmentState) -> CommitmentStatus:
    return CommitmentStatus(
        id=f"commitment:{state.bookmark_id}", bookmark_id=state.bookmark_id, open=state.open,
        closed_by=state.closed_by, closed_at=state.closed_at, closed_session_id=state.closed_session_id,
        evidence=state.evidence)


@router.post("/graph/commitment/{commitment_id}", response_model=CommitmentStatus)
def update_commitment(commitment_id: str, body: CommitmentUpdate,
                      st: AppState = Depends(get_app_state)) -> CommitmentStatus:
    """Mark a promise done (`open: false`) or reopen it (`open: true`). Accepts `commitment:<id>` or `<id>`.
    A manual state wins over the automatic check from then on."""
    bookmark_id = parse_commitment_id(commitment_id)
    if bookmark_id is None or not is_promise(st.db, bookmark_id):
        raise HTTPException(404, f"commitment {commitment_id} not found")
    return commitment_status(set_manual(st.db, bookmark_id, body.open))
