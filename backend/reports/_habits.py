"""Habits report (GET /reports/habits) and the per-habit counts the overview reuses.

A habit is a nudge rule that fired, buzzed or quietly. Its rate is hits per conversation across
ALL conversations in the window (conversations where it never fired count as zero). Its trend
needs MIN_COMPARE conversations in each window AND MIN_HABIT_HITS hits across both. If-then plans:
a debrief's if-then belongs to the habit that fired most in that conversation (ties: more buzzes,
then rule id), because debriefs do not name the habit they target.
"""

from __future__ import annotations

from collections.abc import Sequence

from backend.contracts import HabitReport, HabitsReport, ReportHabitCount
from backend.graph._rows import Conversation
from backend.growth._store import rule_label
from backend.reports._input import ReportInput
from backend.reports._measures import MIN_COMPARE, buckets, compare
from backend.reports._shared import (
    Focus, counts, habit_node, person_node, topic_labels, topic_node, topic_slugs,
)

MAX_IF_THEN = 3
MIN_HABIT_HITS = 3  # a habit's trend needs at least this many hits across both windows


def _hits(convs: Sequence[Conversation], rule_id: str) -> list[tuple[Conversation, bool]]:
    return [(c, h.loud) for c in convs for h in c.habits if h.rule_id == rule_id]


def _rate(convs: Sequence[Conversation], rule_id: str) -> float | None:
    return round(len(_hits(convs, rule_id)) / len(convs), 2) if convs else None


def habit_count(inp: ReportInput, rule_id: str) -> ReportHabitCount:
    hits = _hits(inp.current, rule_id)
    buzzed = sum(1 for _, loud in hits if loud)
    seen = len(hits) + len(_hits(inp.previous, rule_id))
    enough = len(inp.current) >= MIN_COMPARE and len(inp.previous) >= MIN_COMPARE and seen >= MIN_HABIT_HITS
    trend = compare("habit_per_conversation", _rate(inp.current, rule_id), _rate(inp.previous, rule_id),
                    len(inp.current), len(inp.previous), enough)
    return ReportHabitCount(
        rule_id=rule_id, node_id=habit_node(rule_id), label=rule_label(rule_id), total=len(hits), buzzed=buzzed,
        quiet=len(hits) - buzzed, conversations=len({c.session_id for c, _ in hits}),
        per_conversation=_rate(inp.current, rule_id), trend=trend)


def rule_ids(inp: ReportInput) -> list[str]:
    """Rules seen in either window."""
    return sorted({h.rule_id for c in (*inp.current, *inp.previous) for h in c.habits})


def habit_counts_for(inp: ReportInput) -> list[ReportHabitCount]:
    """Most hits first, then rule id."""
    return sorted((habit_count(inp, r) for r in rule_ids(inp)), key=lambda h: (-h.total, h.rule_id))


def best_habit(habits: Sequence[ReportHabitCount]) -> ReportHabitCount | None:
    """Biggest relative improvement against the previous window, or None."""
    improved = [h for h in habits if h.trend.better is True and h.trend.previous]
    return max(improved, key=lambda h: -(h.trend.change or 0) / (h.trend.previous or 1), default=None)


def weakest_habit(inp: ReportInput, habits: Sequence[ReportHabitCount],
                  best: ReportHabitCount | None) -> ReportHabitCount | None:
    """Highest rate in the window (needs MIN_COMPARE conversations), other than the best habit."""
    if len(inp.current) < MIN_COMPARE:
        return None
    rest = [h for h in habits if h.total > 0 and (best is None or h.rule_id != best.rule_id)]
    return max(rest, key=lambda h: h.per_conversation or 0, default=None)  # ties: list order (rule id)


def _top_rule(c: Conversation) -> str | None:
    tally: dict[str, tuple[int, int]] = {}
    for h in c.habits:
        n, loud = tally.get(h.rule_id, (0, 0))
        tally[h.rule_id] = (n + 1, loud + int(h.loud))
    if not tally:
        return None
    return min(tally, key=lambda r: (-tally[r][0], -tally[r][1], r))


def if_then_plans(convs: Sequence[Conversation], rule_id: str) -> list[str]:
    plans = (c.if_then for c in convs if c.if_then and _top_rule(c) == rule_id)
    return list(dict.fromkeys(plans))[:MAX_IF_THEN]


def _habit_report(inp: ReportInput, habit: ReportHabitCount, labels: dict[str, str]) -> HabitReport:
    hits = _hits(inp.current, habit.rule_id)
    by_person = counts((person_node(c.person_id), inp.name(c.person_id), 1) for c, _ in hits if c.person_id)
    by_topic = counts((topic_node(s), labels.get(s, s), 1) for c, _ in hits for s in topic_slugs(c))
    return HabitReport(
        habit=habit, series=buckets(inp.first_day, inp.days, [(c.started_ts, 1) for c, _ in hits]),
        by_person=by_person, by_topic=by_topic, if_then=if_then_plans(inp.current, habit.rule_id))


def habits_report(inp: ReportInput) -> HabitsReport:
    habits = habit_counts_for(inp)
    labels = topic_labels(inp.current)
    focus = Focus().from_me(h.node_id for h in habits if h.total > 0)
    return HabitsReport(window=inp.window, habits=[_habit_report(inp, h, labels) for h in habits],
                        graph_focus=focus.build())
