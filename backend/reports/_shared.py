"""Pure building blocks shared by every report: graph node ids, rankings, conversation rows,
promise rows and the graph focus. Node and edge ids match backend/graph/_build.py exactly."""

from __future__ import annotations

from collections.abc import Callable, Iterable, Sequence

from backend.contracts import (
    GraphFocus, GraphFocusEdge, ReportConversation, ReportCount, ReportPromise, ReportRank,
)
from backend.graph._build import ME, commitment_label, conversation_id, is_overdue, promise_due
from backend.graph._rows import Conversation, Promise
from backend.graph._topics import slugify
from backend.growth._store import rule_label
from backend.reports._input import DAY_S, ReportInput

TOP_N = 5
TIMELINE_MAX = 20


def person_node(person_id: str) -> str:
    return f"person:{person_id}"


def topic_node(slug: str) -> str:
    return f"topic:{slug}"


def habit_node(rule_id: str) -> str:
    return f"habit:{rule_id}"


def commitment_node(bookmark_id: int) -> str:
    return f"commitment:{bookmark_id}"


def topic_slugs(c: Conversation) -> list[str]:
    return list(dict.fromkeys(s for s in (slugify(t) for t in c.topics) if s))


def topic_labels(convs: Iterable[Conversation]) -> dict[str, str]:
    """slug -> label, the newest conversation's wording winning (as in the graph)."""
    return {slugify(t): t for c in reversed(list(convs)) for t in reversed(c.topics) if slugify(t)}


def group_by(convs: Iterable[Conversation], keys: Callable[[Conversation], Iterable[str]]
             ) -> dict[str, list[Conversation]]:
    out: dict[str, list[Conversation]] = {}
    for c in convs:
        for key in dict.fromkeys(keys(c)):
            out.setdefault(key, []).append(c)
    return out


def minutes(convs: Iterable[Conversation]) -> float:
    return round(sum(c.duration_s for c in convs) / 60, 1)


def rank(groups: dict[str, list[Conversation]], node: Callable[[str], str], label: Callable[[str], str],
         limit: int = TOP_N) -> list[ReportRank]:
    """Most conversations first, then most minutes, then id."""
    rows = [ReportRank(node_id=node(k), label=label(k), conversations=len(cs), minutes=minutes(cs))
            for k, cs in groups.items()]
    return sorted(rows, key=lambda r: (-r.conversations, -r.minutes, r.node_id))[:limit]


def counts(pairs: Iterable[tuple[str, str, int]], limit: int = TOP_N) -> list[ReportCount]:
    """(node_id, label, count) summed per node; biggest first; zero counts dropped."""
    total: dict[str, int] = {}
    labels: dict[str, str] = {}
    for node, label, n in pairs:
        total[node] = total.get(node, 0) + n
        labels[node] = label
    rows = [ReportCount(node_id=k, label=labels[k], count=v) for k, v in total.items() if v > 0]
    return sorted(rows, key=lambda r: (-r.count, r.node_id))[:limit]


def habit_counts(convs: Iterable[Conversation]) -> list[ReportCount]:
    return counts((habit_node(h.rule_id), rule_label(h.rule_id), 1) for c in convs for h in c.habits)


def conversation_row(c: Conversation) -> ReportConversation:
    n = c.summary.numbers
    return ReportConversation(
        session_id=c.session_id, node_id=conversation_id(c.session_id), started_at=c.started_ts,
        minutes=round(c.duration_s / 60, 1), minutes_spoken=round(c.minutes_spoken, 1), talk_ratio=c.talk_ratio,
        wpm=c.wpm, fillers_per_min=n.fillers_per_min, interruptions=n.interruptions, questions=n.questions,
        headline=c.headline, person_node_id=person_node(c.person_id) if c.person_id else None,
        topic_ids=[topic_node(s) for s in topic_slugs(c)])


def timeline(convs: Sequence[Conversation]) -> list[ReportConversation]:
    return [conversation_row(c) for c in convs[:TIMELINE_MAX]]


def promise_row(inp: ReportInput, c: Conversation, p: Promise) -> ReportPromise:
    state = inp.commitment(p.bookmark_id)
    due = promise_due(c, p)
    made = c.started_ts + p.ts
    return ReportPromise(
        id=commitment_node(p.bookmark_id), bookmark_id=p.bookmark_id, text=commitment_label(p),
        quote=p.text or None, person_id=c.person_id, person_name=inp.name(c.person_id) if c.person_id else None,
        person_node_id=person_node(c.person_id) if c.person_id else None, session_id=c.session_id,
        conversation_node_id=conversation_id(c.session_id), made_at=round(made, 3),
        age_days=max(0, int((inp.now - made) // DAY_S)), open=state.open, closed_by=state.closed_by,
        closed_at=state.closed_at, closed_session_id=state.closed_session_id, evidence=state.evidence,
        due_day=due.isoformat() if due else None, overdue=is_overdue(state, due, inp.now))


def promise_rows(inp: ReportInput, convs: Iterable[Conversation]) -> list[ReportPromise]:
    """Oldest first."""
    rows = [promise_row(inp, c, p) for c in convs for p in c.promises]
    return sorted(rows, key=lambda r: (r.made_at, r.bookmark_id))


class Focus:
    """Collects node ids and edges for a GraphFocus; order kept, duplicates dropped."""

    def __init__(self) -> None:
        self._nodes: dict[str, None] = {ME: None}
        self._edges: dict[tuple[str, str], None] = {}

    def node(self, *ids: str) -> Focus:
        self._nodes.update(dict.fromkeys(ids))
        return self

    def edge(self, source: str, target: str) -> Focus:
        self.node(source, target)
        self._edges[(source, target)] = None
        return self

    def from_me(self, ids: Iterable[str]) -> Focus:
        for i in ids:
            self.edge(ME, i)
        return self

    def conversations(self, convs: Iterable[Conversation], *, topics: bool = True, habits: bool = True,
                      promises: bool = True) -> Focus:
        """Each conversation node with its edges to its person, topics, habits and promises."""
        for c in convs:
            cid = conversation_id(c.session_id)
            self.node(cid)
            if c.person_id:
                self.edge(cid, person_node(c.person_id))
            for s in topic_slugs(c) if topics else ():
                self.edge(cid, topic_node(s))
            for rule in dict.fromkeys(h.rule_id for h in c.habits) if habits else ():
                self.edge(cid, habit_node(rule))
            for p in c.promises if promises else ():
                self.edge(cid, commitment_node(p.bookmark_id))
                if c.person_id:
                    self.edge(commitment_node(p.bookmark_id), person_node(c.person_id))
        return self

    def build(self) -> GraphFocus:
        return GraphFocus(node_ids=list(self._nodes),
                          edges=[GraphFocusEdge(source=s, target=t) for s, t in self._edges])
