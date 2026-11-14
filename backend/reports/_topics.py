"""Topic reports (GET /reports/by-topic, GET /reports/topic/{id}).

Topics are the graph's canonical (merged) cached labels; no LLM is called here. "How you speak on
the topic" compares the conversations that touched it with the wearer's other conversations in the
window (conversation-level numbers; turns are not attributed to topics). Promises are tied to a
topic when made in a conversation about it AND their text names one of the topic's core words.
Quotes are the wearer's own lines that name a core word, clipped to MAX_QUOTE_CHARS.
"""

from __future__ import annotations

import re
from collections.abc import Sequence

from backend.contracts import (
    ByTopicReport, ReportMeasure, ReportPromise, ReportQuote, TopicReport, TopicReportSummary,
)
from backend.graph._merge import core
from backend.graph._rows import Conversation
from backend.reports._input import ReportInput
from backend.reports._measures import buckets, compare, comparison, strongest
from backend.reports._sentences import topic_sentence
from backend.reports._shared import (
    Focus, group_by, habit_counts, minutes, person_node, promise_rows, rank, timeline, topic_labels, topic_node,
    topic_slugs,
)

TOPIC_METRICS: tuple[ReportMeasure, ...] = ("wpm", "fillers_per_min", "talk_ratio")
MAX_QUOTES = 5
QUOTES_PER_CONVERSATION = 2
MAX_QUOTE_CHARS = 160
_SENTENCE = re.compile(r"[^.!?]+[.!?]?")


def parse_topic_id(raw: str) -> str:
    return raw.split(":", 1)[1] if raw.startswith("topic:") else raw


def _on(convs: Sequence[Conversation], slug: str) -> list[Conversation]:
    return [c for c in convs if slug in topic_slugs(c)]


def _pattern(label: str) -> re.Pattern[str] | None:
    words = [w for w in core(label) if len(w) >= 3]
    if not words:
        return None
    return re.compile(r"\b(" + "|".join(re.escape(w) for w in words) + r")", re.IGNORECASE)


def _clip(text: str, pattern: re.Pattern[str]) -> str:
    sentence = next((s.strip() for s in _SENTENCE.findall(text) if pattern.search(s)), text.strip())
    if len(sentence) <= MAX_QUOTE_CHARS:
        return sentence
    return sentence[: MAX_QUOTE_CHARS - 1].rsplit(" ", 1)[0].rstrip(",;: ") + "…"


def quotes(convs: Sequence[Conversation], label: str) -> list[ReportQuote]:
    """The wearer's own words naming the topic, newest conversation first."""
    pattern = _pattern(label)
    if pattern is None:
        return []
    out: list[ReportQuote] = []
    for c in convs:
        mine = [ln for ln in c.lines if ln.speaker == "me" and pattern.search(ln.text)]
        out += [ReportQuote(session_id=c.session_id, ts=round(c.started_ts + ln.start, 3), text=_clip(ln.text, pattern))
                for ln in mine[:QUOTES_PER_CONVERSATION]]
    return out[:MAX_QUOTES]


def tied_promises(inp: ReportInput, convs: Sequence[Conversation], label: str) -> list[ReportPromise]:
    pattern = _pattern(label)
    rows = promise_rows(inp, convs)
    return [r for r in rows if pattern and pattern.search(f"{r.text} {r.quote or ''}")]


def topic_summary(inp: ReportInput, slug: str, label: str) -> TopicReportSummary:
    on, before = _on(inp.current, slug), _on(inp.previous, slug)
    elsewhere = [c for c in inp.current if slug not in topic_slugs(c)]
    comps = [comparison(m, on, elsewhere) for m in TOPIC_METRICS]
    best = strongest(comps)
    trend = compare("conversations", float(len(on)), float(len(before)), len(on), len(before),
                    enough=len(inp.previous) >= 1)
    people = rank(group_by(on, lambda c: [c.person_id] if c.person_id else []), person_node, inp.name)
    return TopicReportSummary(
        topic_id=slug, node_id=topic_node(slug), label=label, conversations=len(on), minutes_together=minutes(on),
        last_discussed=max((c.started_ts for c in on), default=None), trend=trend, people=people,
        comparisons=comps, sentence=topic_sentence(label, best) if best else None,
        promises=len(tied_promises(inp, on, label)))


def by_topic_report(inp: ReportInput) -> ByTopicReport:
    """Topics of the window: most conversations first, then most recent, then id."""
    labels = topic_labels(inp.current)
    topics = sorted((topic_summary(inp, s, labels[s]) for s in labels),
                    key=lambda t: (-t.conversations, -(t.last_discussed or 0), t.topic_id))
    return ByTopicReport(window=inp.window, topics=topics,
                         graph_focus=Focus().from_me(t.node_id for t in topics).build())


def topic_label(inp: ReportInput, slug: str) -> str | None:
    """The topic's label if it appears in either window, else None."""
    return topic_labels((*inp.previous, *inp.current)).get(slug)


def topic_report(inp: ReportInput, slug: str, label: str) -> TopicReport:
    on = _on(inp.current, slug)
    node = topic_node(slug)
    focus = Focus().edge("me", node).conversations(on, topics=False, habits=False, promises=False)
    for c in on:
        focus.edge(f"conversation:{c.session_id}", node)
    tied = tied_promises(inp, on, label)
    for r in tied:
        focus.edge(r.conversation_node_id, r.id)
    return TopicReport(
        window=inp.window, topic=topic_summary(inp, slug, label),
        series=buckets(inp.first_day, inp.days, [(c.started_ts, 1) for c in on]), promises=tied,
        quotes=quotes(on, label), habits=habit_counts(on), timeline=timeline(on), graph_focus=focus.build())
