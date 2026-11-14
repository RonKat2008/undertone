"""People reports (GET /reports/by-person, GET /reports/person/{id}).

The wearer with one person against the wearer in all their OTHER kept conversations of the
window (never against anyone else's numbers). A ready sentence is given only for a meaningful
difference (see _measures.py: at least 3 conversations each side, ratio >= 1.25 or <= 0.8,
and a per-measure absolute minimum).
"""

from __future__ import annotations

from backend.contracts import ByPersonReport, PersonReport, PersonReportSummary, ReportMeasure, ReportRank
from backend.graph._rows import Conversation
from backend.reports._input import ReportInput
from backend.reports._measures import comparison, measure, strongest
from backend.reports._sentences import person_sentence
from backend.reports._shared import (
    Focus, group_by, habit_counts, minutes, person_node, promise_rows, rank, timeline, topic_labels, topic_node,
    topic_slugs,
)

PERSON_METRICS: tuple[ReportMeasure, ...] = ("interruptions", "questions", "talk_ratio", "wpm")
TOP_TOPICS = 3


def known_person_ids(inp: ReportInput) -> list[str]:
    tagged = [c.person_id for c in (*inp.current, *inp.previous) if c.person_id]
    return list(dict.fromkeys([*(pid for pid, _ in inp.people), *tagged]))


def parse_person_id(raw: str) -> str:
    return raw.split(":", 1)[1] if raw.startswith("person:") else raw


def _theirs(inp: ReportInput, person_id: str) -> list[Conversation]:
    return [c for c in inp.current if c.person_id == person_id]


def _topic_rank(convs: list[Conversation], limit: int) -> list[ReportRank]:
    labels = topic_labels(convs)
    return rank(group_by(convs, topic_slugs), topic_node, lambda s: labels.get(s, s), limit)


def person_summary(inp: ReportInput, person_id: str) -> PersonReportSummary:
    theirs = _theirs(inp, person_id)
    others = [c for c in inp.current if c.person_id != person_id]
    comps = [comparison(m, theirs, others) for m in PERSON_METRICS]
    best = strongest(comps)
    name = inp.name(person_id)
    first = name.split()[0] if name.split() else name
    return PersonReportSummary(
        person_id=person_id, node_id=person_node(person_id), name=name, conversations=len(theirs),
        minutes_together=minutes(theirs), minutes_spoken=measure(theirs, "minutes_spoken") or 0.0,
        last_talked=max((c.started_ts for c in theirs), default=None), comparisons=comps,
        sentence=person_sentence(first, best) if best else None,
        open_promises=sum(1 for r in promise_rows(inp, theirs) if r.open),
        top_topics=_topic_rank(theirs, TOP_TOPICS))


def by_person_report(inp: ReportInput) -> ByPersonReport:
    """People talked with in the window: most conversations first, then most recent."""
    ids = list(dict.fromkeys(c.person_id for c in inp.current if c.person_id))
    people = sorted((person_summary(inp, pid) for pid in ids),
                    key=lambda p: (-p.conversations, -(p.last_talked or 0), p.person_id))
    focus = Focus().from_me(p.node_id for p in people)
    return ByPersonReport(window=inp.window, people=people,
                          untagged_conversations=sum(1 for c in inp.current if not c.person_id),
                          graph_focus=focus.build())


def person_report(inp: ReportInput, person_id: str) -> PersonReport:
    theirs = _theirs(inp, person_id)
    summary = person_summary(inp, person_id)
    focus = Focus().edge("me", summary.node_id).conversations(theirs)
    return PersonReport(
        window=inp.window, person=summary, topics=_topic_rank(theirs, 10),
        promises=promise_rows(inp, theirs), habits=habit_counts(theirs), timeline=timeline(theirs),
        graph_focus=focus.build())
