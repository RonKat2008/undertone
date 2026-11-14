"""A small built-in illustrative graph, returned (with `sample: true`) only when the database has
no sessions at all, so the dashboard is never empty. Every node carries `meta.sample = true`,
the wearer is "You (sample)" and people are labelled "(example)". Never written to the database."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from backend.contracts import DebriefNumbers, GraphNode, KnowledgeGraph, SessionSummary
from backend.graph._build import build_graph
from backend.graph._rows import Conversation, GraphInput, HabitHit, Line, Promise

DAY_S = 86_400.0
SAMPLE_BOOKMARK_ID = 900
_PEOPLE = (("example-alex", "Alex (example)"), ("example-priya", "Priya (example)"))


@dataclass(frozen=True)
class _Example:
    session_id: str
    days_ago: int
    person_id: str
    minutes: float
    talk_ratio: float
    wpm: float
    topics: tuple[str, ...]
    habits: tuple[str, ...]
    promise: str
    lines: tuple[tuple[str, str], ...]  # (speaker, text)


_EXAMPLES: tuple[_Example, ...] = (
    _Example("example_3", 1, "example-alex", 14, 0.52, 156, ("product roadmap", "hiring"), ("interrupt",), "",
             (("other", "The roadmap looks better this week."), ("me", "We still need one more hire for Q1."),
              ("other", "Let's open the hiring req."))),
    _Example("example_2", 4, "example-priya", 11, 0.55, 160, ("climbing", "weekend plans"), ("fillers",), "",
             (("me", "How did the climbing competition go?"), ("other", "Terrifying but fun."),
              ("me", "Any weekend plans after that?"))),
    _Example("example_1", 6, "example-alex", 15, 0.66, 168, ("product roadmap", "promotion"),
             ("interrupt", "interrupt"), "I'll send you the launch plan by Friday.",
             (("other", "Let's start with the product roadmap."),
              ("me", "The roadmap slipped because the vendor changed."),
              ("other", "What do you need for the promotion case?"),
              ("me", "I'll send you the launch plan by Friday."))),
)


def _lines(ex: _Example) -> tuple[Line, ...]:
    slot = ex.minutes * 60 / len(ex.lines)
    return tuple(Line(speaker=s, text=t, start=i * slot, end=(i + 0.9) * slot)  # type: ignore[arg-type]
                 for i, (s, t) in enumerate(ex.lines))


def _conversation(ex: _Example, now: float) -> Conversation:
    started = now - ex.days_ago * DAY_S
    lines = _lines(ex)
    promises = (Promise(bookmark_id=SAMPLE_BOOKMARK_ID + ex.days_ago, ts=lines[-1].start, text=ex.promise,
                        follow_up="Send Alex the launch plan"),) if ex.promise else ()
    numbers = DebriefNumbers(talk_ratio=ex.talk_ratio, interruptions=ex.habits.count("interrupt"), questions=1,
                             fillers_per_min=2.0, wpm=ex.wpm)
    summary = SessionSummary(
        session_id=ex.session_id, started_at=datetime.fromtimestamp(started, tz=timezone.utc).isoformat(),
        duration_s=ex.minutes * 60, coach_name="Listener", mode="regular", person_id=ex.person_id,
        headline_fact="Example conversation.", numbers=numbers)
    return Conversation(
        session_id=ex.session_id, started_ts=started, duration_s=ex.minutes * 60, coach_id="listener",
        person_id=ex.person_id, talk_ratio=ex.talk_ratio, wpm=ex.wpm, headline="Example conversation.",
        topics=ex.topics, habits=tuple(HabitHit(rule_id=h, loud=True, ts=lines[1].start) for h in ex.habits),
        promises=promises, lines=lines, summary=summary)


def sample_input(now: float) -> GraphInput:
    return GraphInput(conversations=tuple(_conversation(ex, now) for ex in _EXAMPLES), people=_PEOPLE,
                      has_any_session=False)


def _mark(n: GraphNode) -> GraphNode:
    label = "You (sample)" if n.kind == "me" else n.label
    return n.model_copy(update={"label": label, "meta": {**n.meta, "sample": True}})


def mark_sample(graph: KnowledgeGraph) -> KnowledgeGraph:
    return graph.model_copy(update={"nodes": [_mark(n) for n in graph.nodes], "sample": True})


def sample_graph(now: float) -> KnowledgeGraph:
    return mark_sample(build_graph(sample_input(now), now))
