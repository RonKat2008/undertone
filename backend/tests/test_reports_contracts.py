"""Report and commitment REST types: field parity with contracts/events.ts and exact round-trips."""

from __future__ import annotations

import copy
import re
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from backend import contracts as c

EVENTS_TS = Path(__file__).resolve().parents[2] / "contracts" / "events.ts"
EXTRA_TYPES = ("CommitmentUpdate", "CommitmentStatus")


def _ts_interface_fields(name: str) -> set[str]:
    match = re.search(r"export interface " + name + r" \{(.*?)\n\}", EVENTS_TS.read_text(), re.S)
    assert match, f"{name} missing from events.ts"
    return set(re.findall(r"^\s+(\w+):", match.group(1), re.M))


def _ts_union(name: str) -> set[str]:
    match = re.search(r"export type " + name + r" =([^;]+);", EVENTS_TS.read_text())
    assert match, f"{name} missing from events.ts"
    return set(re.findall(r"'([a-z_]+)'", match.group(1)))


def _ts_report_interfaces() -> set[str]:
    src = EVENTS_TS.read_text()
    section = src[src.index("// ---------- REST payloads: reports"):]
    return set(re.findall(r"export interface (\w+) \{", section))


def test_report_type_list_matches_ts() -> None:
    assert len(c.REPORT_TYPES) == 26
    assert set(c.REPORT_TYPES) == _ts_report_interfaces()


@pytest.mark.parametrize("name", [*c.REPORT_TYPES, *EXTRA_TYPES])
def test_report_fields_match_ts(name: str) -> None:
    model: type[BaseModel] = getattr(c, name)
    assert set(model.model_fields) == _ts_interface_fields(name)


@pytest.mark.parametrize(("literal", "ts_name", "size"), [
    (c.ReportMeasure, "ReportMeasure", 8), (c.ReportDirection, "ReportDirection", 4),
    (c.ReportHighlightKind, "ReportHighlightKind", 7), (c.CommitmentClosedBy, "CommitmentClosedBy", 2),
])
def test_report_literals_match_ts(literal: Any, ts_name: str, size: int) -> None:
    assert set(literal.__args__) == _ts_union(ts_name) and len(literal.__args__) == size


WINDOW = {"days": 30, "start": 1760000000.0, "end": 1762592000.0, "previous_start": 1757408000.0}
DELTA = {"metric": "talk_ratio", "current": 0.55, "previous": 0.66, "change": -0.11, "direction": "down",
         "better": True, "sample": 4, "previous_sample": 4}
FOCUS = {"node_ids": ["me", "person:alex"], "edges": [{"source": "me", "target": "person:alex"}]}
HABIT = {"rule_id": "interrupt", "node_id": "habit:interrupt", "label": "Interrupting", "total": 7, "buzzed": 6,
         "quiet": 1, "conversations": 3, "per_conversation": 1.75, "trend": {**DELTA, "metric": "habit_per_conversation"}}
PROMISE = {"id": "commitment:3", "bookmark_id": 3, "text": "Send Alex the deck", "quote": "I'll send the deck.",
           "person_id": "alex", "person_name": "Alex", "person_node_id": "person:alex", "session_id": "s1",
           "conversation_node_id": "conversation:s1", "made_at": 1762000000.0, "age_days": 6, "open": False,
           "closed_by": "auto", "closed_at": 1762100000.0, "closed_session_id": "s2",
           "evidence": "I sent the deck.", "due_day": "2026-11-13", "overdue": False}
EXAMPLES: dict[str, dict[str, Any]] = {
    "OverviewReport": {
        "window": WINDOW,
        "totals": {"conversations": 4, "minutes_spoken": 21.5, "minutes_together": 48.0, "interruptions": 8,
                   "questions": 12, "nudges": 6, "quiet_marks": 9},
        "measures": [DELTA, {"metric": "wpm", "current": 160.0, "previous": None, "change": None,
                             "direction": "insufficient_data", "better": None, "sample": 4, "previous_sample": 0}],
        "habits": [HABIT], "best_habit": HABIT, "weakest_habit": None,
        "promises": {"made": 2, "open": 1, "done": 1, "overdue": 0},
        "top_people": [{"node_id": "person:alex", "label": "Alex", "conversations": 2, "minutes": 29.0}],
        "top_topics": [],
        "series": [{"day": "2026-11-13", "conversations": 1, "minutes_spoken": 6.6, "talk_ratio": 0.55,
                    "wpm": 158.0, "fillers_per_min": 5.2, "interruptions": 2, "questions": 3, "nudges": 2,
                    "quiet_marks": 3},
                   {"day": "2026-11-14", "conversations": 0, "minutes_spoken": 0.0, "talk_ratio": None, "wpm": None,
                    "fillers_per_min": None, "interruptions": 0, "questions": 0, "nudges": 0, "quiet_marks": 0}],
        "highlights": [{"kind": "improved", "text": "You talked less of the time.", "node_ids": ["me"]}],
        "insufficient_data": False, "graph_focus": FOCUS,
    },
    "PromisesReport": {"window": WINDOW, "counts": {"made": 1, "open": 0, "done": 1, "overdue": 0}, "open": [],
                       "done": [PROMISE], "graph_focus": FOCUS},
    "HabitsReport": {"window": WINDOW, "graph_focus": FOCUS, "habits": [{
        "habit": HABIT, "series": [{"start": "2026-11-08", "days": 7, "count": 5}],
        "by_person": [{"node_id": "person:alex", "label": "Alex", "count": 5}], "by_topic": [],
        "if_then": ["When Alex pauses, count one breath before you answer."]}]},
}


@pytest.mark.parametrize("name", sorted(EXAMPLES))
def test_report_round_trip_is_exact(name: str) -> None:
    model = getattr(c, name).model_validate(copy.deepcopy(EXAMPLES[name]))
    assert model.model_dump(mode="json") == EXAMPLES[name]


@pytest.mark.parametrize("bad", [{"direction": "sideways"}, {"metric": "volume"}, {"surprise": 1}])
def test_bad_delta_raises(bad: dict[str, Any]) -> None:
    with pytest.raises(ValidationError):
        c.ReportDelta.model_validate({**DELTA, **bad})


def test_commitment_round_trip() -> None:
    status = {"id": "commitment:3", "bookmark_id": 3, "open": True, "closed_by": None, "closed_at": None,
              "closed_session_id": None, "evidence": None}
    assert c.CommitmentStatus.model_validate(status).model_dump(mode="json") == status
    assert c.CommitmentUpdate.model_validate({"open": False}).open is False
    with pytest.raises(ValidationError):
        c.CommitmentUpdate.model_validate({"open": False, "why": "x"})
