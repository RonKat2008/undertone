"""Pure graph building: GraphInput -> KnowledgeGraph. No I/O, no clock, deterministic order."""

from __future__ import annotations

from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import datetime, timezone

from backend.contracts import GraphEdge, GraphNode, GraphStats, KnowledgeGraph
from backend.graph._rows import Conversation, GraphInput, Promise
from backend.graph._topics import slugify
from backend.growth._store import rule_label

ME = "me"
MAX_COMMITMENT_LABEL = 80
KIND_ORDER = ("me", "person", "topic", "commitment", "habit", "conversation")
# At most 150 nodes: `me` plus these per-kind quotas (highest weight, then most recent).
KIND_CAPS: dict[str, int] = {"conversation": 60, "topic": 40, "person": 20, "habit": 15, "commitment": 14}


@dataclass(frozen=True)
class Part:
    nodes: tuple[GraphNode, ...]
    edges: tuple[GraphEdge, ...]


def conversation_id(session_id: str) -> str:
    return f"conversation:{session_id}"


def _day(ts: float) -> str:
    d = datetime.fromtimestamp(ts, tz=timezone.utc)
    return f"{d.day} {d.strftime('%b')}"


def _conversation_node(c: Conversation, names: dict[str, str]) -> GraphNode:
    who = names.get(c.person_id or "", c.person_id or c.summary.coach_name)
    return GraphNode(
        id=conversation_id(c.session_id), kind="conversation", label=f"{who}, {_day(c.started_ts)}",
        weight=round(c.duration_s / 60, 1), last_seen=c.started_ts,
        meta={"duration_s": c.duration_s, "talk_ratio": c.talk_ratio, "wpm": c.wpm, "coach_id": c.coach_id,
              "headline": c.headline or None, "person_id": c.person_id})


def _grouped(convs: Iterable[Conversation],
             keys: Callable[[Conversation], Iterable[str]]) -> dict[str, list[Conversation]]:
    out: dict[str, list[Conversation]] = {}
    for c in convs:
        for key in dict.fromkeys(keys(c)):
            out.setdefault(key, []).append(c)
    return out


def _people(inp: GraphInput) -> Part:
    names = dict(inp.people)
    groups = _grouped(inp.conversations, lambda c: [c.person_id] if c.person_id else [])
    nodes = tuple(GraphNode(id=f"person:{pid}", kind="person", label=names.get(pid, pid), weight=len(cs),
                            last_seen=max(c.started_ts for c in cs), meta={"person_id": pid})
                  for pid, cs in groups.items())
    edges = tuple(GraphEdge(source=ME, target=f"person:{pid}", kind="talked_with", weight=len(cs))
                  for pid, cs in groups.items())
    edges += tuple(GraphEdge(source=conversation_id(c.session_id), target=f"person:{c.person_id}",
                             kind="talked_with", weight=1) for c in inp.conversations if c.person_id)
    return Part(nodes, edges)


def _topic_slugs(c: Conversation) -> list[str]:
    return [s for s in (slugify(t) for t in c.topics) if s]


def _topics(inp: GraphInput) -> Part:
    labels = {slugify(t): t for c in reversed(inp.conversations) for t in reversed(c.topics)}
    groups = _grouped(inp.conversations, _topic_slugs)
    nodes = tuple(GraphNode(id=f"topic:{slug}", kind="topic", label=labels[slug], weight=len(cs),
                            last_seen=max(c.started_ts for c in cs), meta={"slug": slug})
                  for slug, cs in groups.items())
    edges = tuple(GraphEdge(source=ME, target=f"topic:{slug}", kind="about", weight=len(cs))
                  for slug, cs in groups.items())
    edges += tuple(GraphEdge(source=conversation_id(c.session_id), target=f"topic:{slug}", kind="about", weight=1)
                   for c in inp.conversations for slug in dict.fromkeys(_topic_slugs(c)))
    return Part(nodes, edges)


def _habits(inp: GraphInput) -> Part:
    groups = _grouped(inp.conversations, lambda c: [h.rule_id for h in c.habits])
    nodes, edges = [], []
    for rule_id, cs in groups.items():
        hits = [h for c in cs for h in c.habits if h.rule_id == rule_id]
        loud = sum(1 for h in hits if h.loud)
        nodes.append(GraphNode(id=f"habit:{rule_id}", kind="habit", label=rule_label(rule_id), weight=len(hits),
                               last_seen=max(c.started_ts for c in cs),
                               meta={"rule_id": rule_id, "buzzed": loud, "quiet": len(hits) - loud,
                                     "conversations": len(cs)}))
        edges.append(GraphEdge(source=ME, target=f"habit:{rule_id}", kind="showed", weight=len(hits)))
        edges += [GraphEdge(source=conversation_id(c.session_id), target=f"habit:{rule_id}", kind="showed",
                            weight=sum(1 for h in c.habits if h.rule_id == rule_id)) for c in cs]
    return Part(tuple(nodes), tuple(edges))


def commitment_label(p: Promise) -> str:
    label = p.follow_up or p.text or "A promise"
    return label if len(label) <= MAX_COMMITMENT_LABEL else label[: MAX_COMMITMENT_LABEL - 1].rstrip() + "…"


def _commitments(inp: GraphInput) -> Part:
    nodes, edges = [], []
    for c in inp.conversations:
        for p in c.promises:
            cid = f"commitment:{p.bookmark_id}"
            # No completion tracking exists yet, so every promise is open.
            nodes.append(GraphNode(id=cid, kind="commitment", label=commitment_label(p), weight=1,
                                   last_seen=c.started_ts + p.ts,
                                   meta={"open": True, "quote": p.text or None, "session_id": c.session_id}))
            edges.append(GraphEdge(source=ME, target=cid, kind="promised", weight=1))
            edges.append(GraphEdge(source=conversation_id(c.session_id), target=cid, kind="promised", weight=1))
    return Part(tuple(nodes), tuple(edges))


def _me(inp: GraphInput) -> GraphNode:
    convs = inp.conversations
    return GraphNode(id=ME, kind="me", label="Me", weight=len(convs),
                     last_seen=max((c.started_ts for c in convs), default=None),
                     meta={"minutes_spoken": round(sum(c.minutes_spoken for c in convs), 1)})


def _stats(inp: GraphInput, parts: Iterable[Part]) -> GraphStats:
    nodes = [n for p in parts for n in p.nodes]
    return GraphStats(
        conversations=len(inp.conversations), people=sum(1 for n in nodes if n.kind == "person"),
        topics=sum(1 for n in nodes if n.kind == "topic"),
        minutes_spoken=round(sum(c.minutes_spoken for c in inp.conversations), 1),
        open_commitments=sum(1 for n in nodes if n.kind == "commitment" and n.meta.get("open") is True))


def node_order(n: GraphNode) -> tuple[int, float, float, str]:
    return (KIND_ORDER.index(n.kind), -n.weight, -(n.last_seen or 0.0), n.id)


def _edge_order(e: GraphEdge) -> tuple[str, str, str]:
    return (e.source, e.target, e.kind)


def build_graph(inp: GraphInput, now: float) -> KnowledgeGraph:
    """The full, uncapped graph for the loaded window."""
    names = dict(inp.people)
    convs = Part(tuple(_conversation_node(c, names) for c in inp.conversations), ())
    parts = (_people(inp), _topics(inp), _commitments(inp), _habits(inp), convs)
    nodes = sorted([_me(inp), *(n for p in parts for n in p.nodes)], key=node_order)
    edges = sorted((e for p in parts for e in p.edges), key=_edge_order)
    return KnowledgeGraph(nodes=nodes, edges=edges, stats=_stats(inp, parts), generated_at=now, sample=False)


def cap_graph(graph: KnowledgeGraph, caps: dict[str, int] | None = None) -> KnowledgeGraph:
    """Keep `me` and, per kind, the highest-weight then most recent nodes; drop dangling edges.
    Stats keep describing the whole window."""
    limits = caps or KIND_CAPS
    taken: Counter[str] = Counter()
    kept: list[GraphNode] = []
    for n in sorted(graph.nodes, key=node_order):
        if n.kind == "me" or taken[n.kind] < limits.get(n.kind, 0):
            kept.append(n)
            taken[n.kind] += 1
    ids = {n.id for n in kept}
    edges = [e for e in graph.edges if e.source in ids and e.target in ids]
    return graph.model_copy(update={"nodes": kept, "edges": edges})
