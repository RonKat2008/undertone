"""Graph REST types: round-trip like test_contracts.py, and field parity with contracts/events.ts."""

from __future__ import annotations

import copy
import re
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from backend import contracts as c

EVENTS_TS = Path(__file__).resolve().parents[2] / "contracts" / "events.ts"

NODE: dict[str, Any] = {
    "id": "person:alex", "kind": "person", "label": "Alex", "weight": 3.0, "last_seen": 1763100000.0,
    "meta": {"person_id": "alex", "open": True, "count": 2, "ratio": 0.5, "none": None},
}
SUMMARY: dict[str, Any] = {
    "session_id": "s-001", "started_at": "2026-11-14T09:30:00Z", "duration_s": 1260.0, "coach_name": "Listener",
    "mode": "regular", "person_id": "alex", "headline_fact": "You talked 62% of the time.",
    "numbers": {"talk_ratio": 0.62, "interruptions": 3, "questions": 4, "fillers_per_min": 2.5, "wpm": 158.0},
}
GRAPH_EXAMPLES: dict[str, tuple[type[BaseModel], dict[str, Any]]] = {
    "KnowledgeGraph": (c.KnowledgeGraph, {
        "nodes": [NODE, {"id": "me", "kind": "me", "label": "Me", "weight": 8.0, "last_seen": None, "meta": {}}],
        "edges": [{"source": "me", "target": "person:alex", "kind": "talked_with", "weight": 3.0}],
        "stats": {"conversations": 8, "people": 3, "topics": 12, "minutes_spoken": 61.3, "open_commitments": 1},
        "generated_at": 1763100000.5, "sample": False,
    }),
    "GraphNodeDetail": (c.GraphNodeDetail, {
        "node": NODE, "neighbours": [NODE], "conversations": [SUMMARY],
        "quotes": [{"session_id": "s-001", "ts": 1763100300.0, "speaker": "me", "text": "I'll send the deck."}],
    }),
}


@pytest.mark.parametrize("name", sorted(GRAPH_EXAMPLES))
def test_graph_model_round_trip(name: str) -> None:
    cls, example = GRAPH_EXAMPLES[name]
    model = cls.model_validate(copy.deepcopy(example))
    assert model.model_dump(mode="json", by_alias=True) == example


def test_meta_keeps_bool_and_int_types() -> None:
    meta = c.GraphNode.model_validate(NODE).meta
    assert meta["open"] is True and type(meta["count"]) is int and type(meta["ratio"]) is float


@pytest.mark.parametrize("bad", [{"kind": "place"}, {"surprise": 1}, {"meta": {"nested": {"x": 1}}}])
def test_bad_node_raises(bad: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        c.GraphNode.model_validate({**NODE, **bad})


def test_bad_edge_kind_raises() -> None:
    with pytest.raises(ValidationError):
        c.GraphEdge.model_validate({"source": "me", "target": "x", "kind": "likes", "weight": 1})


def _ts_interface_fields(name: str) -> set[str]:
    src = EVENTS_TS.read_text()
    match = re.search(r"export interface " + name + r" \{(.*?)\n\}", src, re.S)
    assert match, f"{name} missing from events.ts"
    return set(re.findall(r"^\s+(\w+):", match.group(1), re.M))


def _ts_union(name: str) -> set[str]:
    match = re.search(r"export type " + name + r" = ([^;]+);", EVENTS_TS.read_text())
    assert match, f"{name} missing from events.ts"
    return set(re.findall(r"'([a-z_]+)'", match.group(1)))


@pytest.mark.parametrize("name", ["GraphNode", "GraphEdge", "GraphStats", "KnowledgeGraph", "GraphQuote",
                                  "GraphNodeDetail"])
def test_graph_fields_match_ts(name: str) -> None:
    model: type[BaseModel] = getattr(c, name)
    assert set(model.model_fields) == _ts_interface_fields(name)


def test_graph_kinds_match_ts() -> None:
    assert set(c.GraphNodeKind.__args__) == _ts_union("GraphNodeKind")  # type: ignore[attr-defined]
    assert set(c.GraphEdgeKind.__args__) == _ts_union("GraphEdgeKind")  # type: ignore[attr-defined]
    assert len(_ts_union("GraphNodeKind")) == 6 and len(_ts_union("GraphEdgeKind")) == 5
