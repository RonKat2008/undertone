"""Overview report (GET /reports/overview): totals, this window against the previous equal window,
habits, promises, top people and topics, a per-day series and up to three highlights.

Highlights are picked deterministically in this order, at most one per kind, three in total:
improved measure, clearest person difference, slipped measure, best habit, open promises, top
topic. When the windows are too small to compare, the first highlight says so plainly.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from backend.contracts import (
    OverviewReport, PersonReportSummary, ReportDelta, ReportHabitCount, ReportHighlight, ReportMeasure,
    ReportPromise, ReportRank, ReportTotals,
)
from backend.graph._rows import Conversation
from backend.reports._habits import best_habit, habit_counts_for, weakest_habit
from backend.reports._input import ReportInput
from backend.reports._measures import MIN_COMPARE, day_series, measure, strongest, window_delta
from backend.reports._people import by_person_report
from backend.reports._promises import promise_counts
from backend.reports._sentences import (
    habit_sentence, insufficient_sentence, measure_sentence, promises_sentence, topic_highlight,
)
from backend.reports._shared import (
    Focus, group_by, person_node, promise_rows, rank, topic_labels, topic_node, topic_slugs,
)

MEASURES: tuple[ReportMeasure, ...] = ("conversations", "minutes_spoken", "talk_ratio", "wpm", "fillers_per_min",
                                       "interruptions", "questions")
MAX_HIGHLIGHTS = 3
MIN_TOPIC_HIGHLIGHT = 2


@dataclass(frozen=True)
class _Parts:
    people: Sequence[PersonReportSummary]
    best: ReportHabitCount | None
    top_topics: Sequence[ReportRank]
    promises: Sequence[ReportPromise]


def totals(convs: Sequence[Conversation]) -> ReportTotals:
    hits = [h for c in convs for h in c.habits]
    return ReportTotals(
        conversations=len(convs), minutes_spoken=measure(convs, "minutes_spoken") or 0.0,
        minutes_together=round(sum(c.duration_s for c in convs) / 60, 1),
        interruptions=sum(c.summary.numbers.interruptions for c in convs),
        questions=sum(c.summary.numbers.questions for c in convs),
        nudges=sum(1 for h in hits if h.loud), quiet_marks=sum(1 for h in hits if not h.loud))


def _relative(d: ReportDelta) -> float:
    return abs(d.change or 0) / abs(d.previous) if d.previous else 0.0


def _distance(p: PersonReportSummary) -> float:
    found = strongest(p.comparisons)
    return max(found.ratio, 1 / found.ratio) if found and found.ratio else 0.0


def _measure_highlight(measures: Sequence[ReportDelta], better: bool, days: int) -> ReportHighlight | None:
    pick = max((d for d in measures if d.better is better), key=_relative, default=None)
    text = measure_sentence(pick, days) if pick else None
    return ReportHighlight(kind="improved" if better else "slipped", text=text, node_ids=["me"]) if text else None


def _promise_highlight(rows: Sequence[ReportPromise]) -> ReportHighlight | None:
    still_open = [r for r in rows if r.open]
    if not still_open:
        return None
    oldest = max(r.age_days for r in still_open)
    return ReportHighlight(kind="promises", text=promises_sentence(len(still_open), oldest),
                           node_ids=[r.id for r in still_open])


def _highlights(inp: ReportInput, measures: Sequence[ReportDelta], parts: _Parts) -> list[ReportHighlight]:
    out: list[ReportHighlight] = []
    comparable = len(inp.current) >= MIN_COMPARE and len(inp.previous) >= MIN_COMPARE
    if not comparable:
        out.append(ReportHighlight(kind="insufficient_data", node_ids=["me"],
                                   text=insufficient_sentence(len(inp.current), len(inp.previous), inp.days)))
    person = max((p for p in parts.people if p.sentence), key=_distance, default=None)
    best = parts.best
    habit_text = habit_sentence(best, inp.days) if best else None
    top = parts.top_topics
    candidates = [
        _measure_highlight(measures, True, inp.days),
        ReportHighlight(kind="person", text=person.sentence, node_ids=[person.node_id]) if person else None,
        _measure_highlight(measures, False, inp.days),
        ReportHighlight(kind="habit", text=habit_text, node_ids=[best.node_id]) if best and habit_text else None,
        _promise_highlight(parts.promises),
        ReportHighlight(kind="topic", text=topic_highlight(top[0].label, top[0].conversations),
                        node_ids=[top[0].node_id]) if top and top[0].conversations >= MIN_TOPIC_HIGHLIGHT else None,
    ]
    out += [h for h in candidates if h is not None]
    return out[:MAX_HIGHLIGHTS]


def overview_report(inp: ReportInput) -> OverviewReport:
    cur = inp.current
    measures = [window_delta(m, cur, inp.previous) for m in MEASURES]
    habits = habit_counts_for(inp)
    best = best_habit(habits)
    rows = promise_rows(inp, cur)
    labels = topic_labels(cur)
    top_people = rank(group_by(cur, lambda c: [c.person_id] if c.person_id else []), person_node, inp.name)
    top_topics = rank(group_by(cur, topic_slugs), topic_node, lambda s: labels.get(s, s))
    people = by_person_report(inp).people
    parts = _Parts(people=people, best=best, top_topics=top_topics, promises=rows)
    focus = Focus().from_me(r.node_id for r in top_people).from_me(r.node_id for r in top_topics)
    focus.from_me(h.node_id for h in habits if h.total > 0).from_me(r.id for r in rows if r.open)
    return OverviewReport(
        window=inp.window, totals=totals(cur), measures=measures, habits=habits, best_habit=best,
        weakest_habit=weakest_habit(inp, habits, best), promises=promise_counts(rows), top_people=top_people,
        top_topics=top_topics, series=day_series(inp.first_day, inp.days, cur),
        highlights=_highlights(inp, measures, parts),
        insufficient_data=len(cur) < MIN_COMPARE or len(inp.previous) < MIN_COMPARE, graph_focus=focus.build())
