"""Knowledge graph (GET /graph, GET /graph/node/{id}, POST /graph/refresh).

The wearer's conversations as a graph: me, people, topics, commitments, habits, conversations.
    _rows.py     immutable input rows
    _load.py     DB -> GraphInput (reuses growth._store.load_sessions); never calls the LLM
    _build.py    pure GraphInput -> KnowledgeGraph, per-kind caps (max 150 nodes)
    _detail.py   pure node detail (neighbours, conversations, quotes)
    _topics.py   topic extraction: LLM (transcript text only) with a keyword fallback
    _merge.py    pure near-duplicate rules + stable incremental label -> canonical assignment
    _aliases.py  topic_aliases table; in-memory rules on reads, one cached LLM consolidation in refresh
    _cache.py    session_topics table (per-session cached topic labels)
    _commitments.py  commitment_status / commitment_checks tables (manual and automatic done state)
    _closing.py  automatic promise closing from later conversations with the same person (LLM, cached)
    _due.py      pure due-day parsing ("by Friday", "tomorrow"); None when not unambiguous
    _refresh.py  background refresh: topics, consolidation, promise checks (POST /graph/refresh, lazily)
An empty database gives a real empty graph: just the `me` node, zero stats, `sample: false`.
"""

from __future__ import annotations

from backend.graph._refresh import refresh_topics
from backend.graph.routes import router

__all__ = ["refresh_topics", "router"]
