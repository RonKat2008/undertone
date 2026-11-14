"""Promises report (GET /reports/promises): promises made in the window, open and done.

Open: oldest first (the ones waiting longest on top). Done: most recently closed first.
"""

from __future__ import annotations

from collections.abc import Sequence

from backend.contracts import PromisesReport, ReportPromise, ReportPromiseCounts
from backend.reports._input import ReportInput
from backend.reports._shared import Focus, promise_rows


def promise_counts(rows: Sequence[ReportPromise]) -> ReportPromiseCounts:
    return ReportPromiseCounts(made=len(rows), open=sum(1 for r in rows if r.open),
                               done=sum(1 for r in rows if not r.open), overdue=sum(1 for r in rows if r.overdue))


def promises_report(inp: ReportInput) -> PromisesReport:
    rows = promise_rows(inp, inp.current)
    still_open = [r for r in rows if r.open]
    done = sorted((r for r in rows if not r.open), key=lambda r: (-(r.closed_at or 0), r.bookmark_id))
    focus = Focus()
    for r in rows:
        focus.edge("me", r.id).edge(r.conversation_node_id, r.id)
        if r.person_node_id:
            focus.edge(r.id, r.person_node_id)
    return PromisesReport(window=inp.window, counts=promise_counts(rows), open=still_open, done=done,
                          graph_focus=focus.build())
