"""Knowledge graph (GET /graph, GET /graph/node/{id}, POST /graph/refresh).

The wearer's conversations as a graph: me, people, topics, commitments, habits, conversations.
    _rows.py     immutable input rows
    _load.py     DB -> GraphInput (reuses growth._store.load_sessions); never calls the LLM
    _build.py    pure GraphInput -> KnowledgeGraph, per-kind caps (max 150 nodes)
    _detail.py   pure node detail (neighbours, conversations, quotes)
    _topics.py   topic extraction: LLM (transcript text only) with a keyword fallback; label merging
    _cache.py    session_topics table (per-session cached topic labels)
    _refresh.py  fills the cache for sessions missing topics (POST /graph/refresh, lazily from GET /graph)
    _sample.py   built-in illustrative graph for an empty database (`sample: true`)
"""

from __future__ import annotations

from backend.graph._refresh import refresh_topics
from backend.graph.routes import router

__all__ = ["refresh_topics", "router"]
