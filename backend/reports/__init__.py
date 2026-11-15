"""Reports (GET /reports/*): the data behind the future Reports tab, "through the map".

Every endpoint takes `days` (default 30), counts only kept conversations, compares the window with
the previous equal window or the wearer's own other conversations (never other people), and
returns a `graph_focus` with node ids and edges of GET /graph to highlight. Deterministic, no LLM.
    _input.py     load both windows once (reuses graph._load: cached, merged topics; promise states)
    _measures.py  pure measures, window comparison, small-sample rules, day series, weekly buckets
    _shared.py    node ids, rankings, conversation and promise rows, the graph focus builder
    _sentences.py ready sentences built from numbers
    _overview.py  /reports/overview
    _people.py    /reports/by-person, /reports/person/{id}
    _topics.py    /reports/by-topic, /reports/topic/{id}
    _habits.py    /reports/habits
    _promises.py  /reports/promises
"""

from __future__ import annotations

from backend.reports.routes import router

__all__ = ["router"]
