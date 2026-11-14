"""Knowledge graph routes. Thin: load rows, call the pure builders, never call the LLM inline."""

from __future__ import annotations

import time

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from pydantic import BaseModel

from backend.contracts import GraphNodeDetail, KnowledgeGraph
from backend.deps import get_app_state
from backend.graph._build import build_graph, cap_graph
from backend.graph._cache import missing_sessions
from backend.graph._detail import node_detail
from backend.graph._load import load_input
from backend.graph._refresh import MAX_PER_RUN, refresh_lazily, refresh_topics
from backend.graph._sample import mark_sample, sample_graph, sample_input
from backend.state import AppState

router = APIRouter(tags=["graph"])

DEFAULT_DAYS = 30
MAX_DAYS = 365


class GraphRefresh(BaseModel):
    refreshed: int  # sessions whose topics were extracted in this call
    remaining: int  # finished sessions still without cached topics


@router.get("/graph", response_model=KnowledgeGraph)
def get_graph(background: BackgroundTasks, days: int = Query(DEFAULT_DAYS, ge=1, le=MAX_DAYS),
              st: AppState = Depends(get_app_state)) -> KnowledgeGraph:
    now = time.time()
    inp = load_input(st.db, days, now)
    if not inp.has_any_session:
        return sample_graph(now)
    if missing_sessions(st.db, 1):
        background.add_task(refresh_lazily, st.db)
    return cap_graph(build_graph(inp, now))


@router.get("/graph/node/{node_id:path}", response_model=GraphNodeDetail)
def get_node(node_id: str, days: int = Query(DEFAULT_DAYS, ge=1, le=MAX_DAYS),
             st: AppState = Depends(get_app_state)) -> GraphNodeDetail:
    now = time.time()
    inp = load_input(st.db, days, now)
    if inp.has_any_session:
        detail = node_detail(inp, build_graph(inp, now), node_id)
    else:
        sample = sample_input(now)
        detail = node_detail(sample, mark_sample(build_graph(sample, now)), node_id)
    if detail is None:
        raise HTTPException(404, f"graph node {node_id} not found")
    return detail


@router.post("/graph/refresh", response_model=GraphRefresh)
async def refresh(st: AppState = Depends(get_app_state)) -> GraphRefresh:
    n = await refresh_topics(st.db, MAX_PER_RUN)
    return GraphRefresh(refreshed=n, remaining=len(missing_sessions(st.db, 10_000)))
