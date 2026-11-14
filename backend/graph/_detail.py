"""Pure node detail: neighbours, related conversations and transcript quotes for one node."""

from __future__ import annotations

import re
from collections.abc import Iterable

from backend.contracts import GraphNode, GraphNodeDetail, GraphQuote, KnowledgeGraph
from backend.graph._build import conversation_id, node_order
from backend.graph._rows import Conversation, GraphInput, Line

MAX_NEIGHBOURS = 50
MAX_CONVERSATIONS = 20
MAX_QUOTES = 8
CONVERSATION_QUOTES = 6
MIN_TOPIC_WORD = 3


def _quote(c: Conversation, speaker: str, text: str, ts: float) -> GraphQuote:
    return GraphQuote(session_id=c.session_id, ts=round(c.started_ts + ts, 3), speaker=speaker,  # type: ignore[arg-type]
                      text=text)


def _line_quote(c: Conversation, ln: Line) -> GraphQuote:
    return _quote(c, ln.speaker, ln.text, ln.start)


def _topic_quotes(convs: Iterable[Conversation], label: str) -> list[GraphQuote]:
    words = [w for w in re.findall(r"[a-z0-9]+", label.lower()) if len(w) >= MIN_TOPIC_WORD]
    if not words:
        return []
    pattern = re.compile(r"\b(" + "|".join(re.escape(w) for w in words) + r")", re.IGNORECASE)
    return [_line_quote(c, ln) for c in convs for ln in c.lines if pattern.search(ln.text)]


def _habit_quotes(convs: Iterable[Conversation], rule_id: str) -> list[GraphQuote]:
    out: list[GraphQuote] = []
    for c in convs:
        mine = [ln for ln in c.lines if ln.speaker == "me"]
        for hit in (h for h in c.habits if h.rule_id == rule_id):
            line = next((ln for ln in reversed(mine) if ln.start <= hit.ts), None)
            if line is not None and (not out or out[-1].ts != round(c.started_ts + line.start, 3)):
                out.append(_line_quote(c, line))
    return out


def _quotes(node: GraphNode, convs: list[Conversation]) -> list[GraphQuote]:
    if node.kind == "conversation":
        return [_line_quote(c, ln) for c in convs for ln in c.lines[:CONVERSATION_QUOTES]]
    if node.kind == "topic":
        return _topic_quotes(convs, node.label)
    if node.kind == "habit":
        return _habit_quotes(convs, str(node.meta.get("rule_id", "")))
    if node.kind == "commitment":
        bid = node.id.split(":", 1)[1]
        return [_quote(c, "me", p.text, p.ts) for c in convs for p in c.promises
                if str(p.bookmark_id) == bid and p.text]
    if node.kind == "person":
        return [_line_quote(c, ln) for c in convs[:1] for ln in c.lines[:CONVERSATION_QUOTES]]
    return []


def neighbours(graph: KnowledgeGraph, node_id: str) -> list[GraphNode]:
    ids = {e.target for e in graph.edges if e.source == node_id} | {e.source for e in graph.edges
                                                                     if e.target == node_id}
    return sorted((n for n in graph.nodes if n.id in ids), key=node_order)


def node_detail(inp: GraphInput, graph: KnowledgeGraph, node_id: str) -> GraphNodeDetail | None:
    node = next((n for n in graph.nodes if n.id == node_id), None)
    if node is None:
        return None
    near = neighbours(graph, node_id)
    related = {n.id for n in near} | {node_id}
    convs = [c for c in inp.conversations if node.kind == "me" or conversation_id(c.session_id) in related]
    return GraphNodeDetail(
        node=node, neighbours=near[:MAX_NEIGHBOURS],
        conversations=[c.summary for c in convs[:MAX_CONVERSATIONS]],
        quotes=_quotes(node, convs)[:MAX_QUOTES])
