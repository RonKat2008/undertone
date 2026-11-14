"""Contract tests: backend/contracts.py must mirror contracts/events.ts exactly."""

from __future__ import annotations

import copy
import re
from pathlib import Path
from typing import Any

import pytest
from pydantic import BaseModel, ValidationError

from backend import contracts as c

EVENTS_TS = Path(__file__).resolve().parents[2] / "contracts" / "events.ts"

POLICY: dict[str, Any] = {
    "focus_rule_id": "interrupt",
    "budget_per_session": 5,
    "min_gap_s": 60.0,
    "tolerance": 0.3,
    "silent": False,
}

NUMBERS: dict[str, Any] = {
    "talk_ratio": 0.62,
    "interruptions": 3,
    "questions": 4,
    "fillers_per_min": 2.5,
    "wpm": 158.0,
}

DEBRIEF: dict[str, Any] = {
    "headline_fact": "You talked 62% of the time; your goal was under 50%.",
    "strength": "You summarised Sam's concern back to him before answering.",
    "one_fix": "You cut Sam off three times while he was mid-sentence.",
    "if_then": "When Sam pauses, count to two before you start speaking.",
    "numbers": NUMBERS,
    "best_moment_quote": "So what would make this a win for your team?",
    "vs_last_time": "Two fewer interruptions than Tuesday.",
    "notes": ["Q3 roadmap", "Hiring for the data team"],
    "bookmarks": [
        {
            "ts": 312.4,
            "source": "promise",
            "snippet": "I'll send you the deck tonight.",
            "what_happened": "You promised to send the deck.",
            "follow_up": "Send Sam the deck",
        },
        {
            "ts": 455.0,
            "source": "phone",
            "snippet": "That's a good point about pricing.",
            "what_happened": "You bookmarked a pricing discussion.",
            "follow_up": None,
        },
    ],
    "timeline": [
        {"t": 0.0, "wpm": 140.0, "volume_db": -24.0, "hand_energy": 0.4},
        {"t": 30.0, "wpm": 172.0, "volume_db": -20.5, "hand_energy": 0.7},
    ],
    "better_version": {
        "original": "Yeah so basically I think we should, um, just ship it.",
        "rewritten": "I think we should ship it. What would stop you?",
        "audio_url": "https://example.com/better.mp3",
    },
}

COACH: dict[str, Any] = {
    "id": "listener",
    "name": "Better Listener",
    "goal": "Let the other person finish and ask more questions.",
    "kind": "prebuilt",
    "confidence_threshold": 0.8,
    "keyterms": ["roadmap", "OKR"],
    "filler_words": ["um", "like", "basically"],
    "questions": {
        "interrupted": {"type": "noul", "instructions": "Did the wearer cut the other person off?"},
        "tone": {
            "type": "choice",
            "instructions": "What was the wearer's tone?",
            "criteria": {"warm": "friendly and open", "curt": "short and dismissive"},
        },
        "clarity": {
            "type": "score",
            "instructions": "How clear was the wearer's point?",
            "criteria": ["one main point", "concrete example", "no hedging"],
        },
    },
    "nudge_rules": [
        {
            "id": "interrupt",
            "when": "judge.interrupted.p >= 0.8",
            "haptic": "interrupt",
            "message": "Let them finish",
            "cooldown_s": 30.0,
            "enabled": True,
        },
        {
            "id": "monologue",
            "when": "metrics.monologue_s > 45",
            "haptic": "wrap_up",
            "message": "Ask a question",
            "cooldown_s": 60.0,
            "enabled": False,
        },
    ],
    "motion_rules": [
        {
            "id": "fidget",
            "when": "motion.state == 'fidget'",
            "haptic": "still",
            "message": "Hands calm",
            "cooldown_s": 45.0,
            "enabled": True,
        }
    ],
    "nudge_policy": POLICY,
    "debrief_rubric": "Focus on listening behaviour.",
    "drill": {
        "partner_persona": "A busy manager who talks fast.",
        "prompts": ["Tell me about your week.", "Why should we fund this?"],
    },
}

EXAMPLES: dict[str, tuple[type[BaseModel], dict[str, Any]]] = {
    "band.status": (c.BandStatusEvent, {
        "type": "band.status", "connected": True, "transport": "ble", "battery_pct": 81.0,
        "mic_on": True,
    }),
    "device.status": (c.DeviceStatusEvent, {
        "type": "device.status", "device_id": "iphone-1", "name": "Ronit's iPhone", "connected": True,
    }),
    "session.started": (c.SessionStartedEvent, {
        "type": "session.started", "session_id": "s-001", "coach_id": "listener",
        "mode": "regular", "policy": POLICY, "ts": 0,
    }),
    "calibration": (c.CalibrationEvent, {
        "type": "calibration", "kind": "speaker", "step": "say your name", "done": False,
    }),
    "transcript.partial": (c.TranscriptPartialEvent, {
        "type": "transcript.partial", "speaker": "me", "text": "So I was thinking",
    }),
    "turn.final": (c.TurnFinalEvent, {
        "type": "turn.final", "turn_id": "t-7", "speaker": "me",
        "text": "Um, so I was thinking we basically ship it.", "start": 12.5, "end": 16.0,
        "wpm": 154.0, "fillers": ["um", "basically"],
    }),
    "motion": (c.MotionEvent, {
        "type": "motion", "state": "fidget", "hand_energy": 0.85, "speaker_context": "other",
        "confidence": 0.9, "ts": 42.1,
    }),
    "judge": (c.JudgeEvent, {
        "type": "judge", "turn_id": "t-7",
        "results": {
            "interrupted": {"kind": "noul", "p": 0.92, "confidence": 0.92},
            "tone": {
                "kind": "choice", "choice": "warm",
                "probabilities": {"warm": 0.7, "curt": 0.3}, "confidence": 0.7,
            },
            "clarity": {"kind": "score", "score": 3.0, "max": 5.0, "confidence": 0.6},
        },
        "latency_ms": 180.0, "source": "decisions",
    }),
    "metrics": (c.MetricsEvent, {
        "type": "metrics", "talk_ratio": 0.55, "interruptions": 2, "questions": 3,
        "fillers_per_min": 1.8, "wpm": 162.0, "baseline_wpm": 150.0, "monologue_s": 21.0,
        "volume_db": -22.0, "volume_state": "ok", "hand_energy": 0.5,
    }),
    "signal": (c.SignalEvent, {
        "type": "signal", "kind": "nerves", "detail": "pace up 20% and fidgeting", "ts": 88.0,
    }),
    "nudge": (c.NudgeEvent, {
        "type": "nudge", "rule_id": "interrupt", "haptic": "interrupt", "message": "Let them finish",
        "reason": "judge.interrupted.p = 0.92", "confidence": 0.92, "latency_ms": 210.0,
        "budget_left": 4, "ts": 16.2,
    }),
    "nudge.snoozed": (c.NudgeSnoozedEvent, {
        "type": "nudge.snoozed", "rule_id": "interrupt", "ts": 17.5,
    }),
    "status.reply": (c.StatusReplyEvent, {
        "type": "status.reply", "verdict": "talking_too_much", "haptic": "status_talking", "ts": 120.0,
    }),
    "bookmark": (c.BookmarkEvent, {
        "type": "bookmark", "source": "phone", "text": "pricing idea", "ts": 455.0,
    }),
    "session.ended": (c.SessionEndedEvent, {"type": "session.ended", "session_id": "s-001"}),
    "debrief": (c.DebriefEvent, {
        "type": "debrief", "session_id": "s-001", "data": DEBRIEF,
        "audio_url": "https://example.com/debrief.mp3",
    }),
    "coach.activated": (c.CoachActivatedEvent, {"type": "coach.activated", "coach": COACH}),
    "app.request": (c.AppRequestEvent, {
        "type": "app.request", "app_id": "calendar-bot", "name": "Calendar Bot",
    }),
}


def _ts_union_body(name: str) -> str:
    src = EVENTS_TS.read_text()
    match = re.search(rf"export type {name}\s*=(.*?);\s*(?://[^\n]*)?\n", src, re.S)
    assert match, f"could not find {name} in events.ts"
    return match.group(1)


def _ts_bus_event_types() -> set[str]:
    src = EVENTS_TS.read_text()
    match = re.search(r"export type BusEvent\s*=(.*?);\s*(?://[^\n]*)?\n\s*\n", src, re.S)
    assert match, "could not find BusEvent union in events.ts"
    return set(re.findall(r"type:\s*'([^']+)'", match.group(1)))


def _ts_haptic_patterns() -> set[str]:
    body = _ts_union_body("HapticPattern")
    body = re.sub(r"//[^\n]*", "", body)
    return set(re.findall(r"'([^']+)'", body))


# ---------- bus events ----------
@pytest.mark.parametrize("etype", sorted(EXAMPLES))
def test_parse_event_returns_right_model(etype: str) -> None:
    cls, example = EXAMPLES[etype]
    model = c.parse_event(copy.deepcopy(example))
    assert type(model) is cls
    assert model.type == etype  # type: ignore[attr-defined]


@pytest.mark.parametrize("etype", sorted(EXAMPLES))
def test_event_round_trip_is_exact(etype: str) -> None:
    _, example = EXAMPLES[etype]
    model = c.parse_event(copy.deepcopy(example))
    assert model.model_dump(mode="json", by_alias=True) == example


def test_examples_cover_every_event_type() -> None:
    assert set(EXAMPLES) == set(c.EVENT_TYPES)


def test_event_types_match_ts_contract() -> None:
    ts_types = _ts_bus_event_types()
    assert len(ts_types) == 18
    assert set(c.EVENT_TYPES) == ts_types


def test_haptic_patterns_match_ts_contract() -> None:
    ts_patterns = _ts_haptic_patterns()
    assert len(ts_patterns) == 11
    assert set(c.HapticPattern.__args__) == ts_patterns  # type: ignore[attr-defined]
    assert c.HAPTIC_PATTERNS == ts_patterns


def test_judge_answer_kinds() -> None:
    model = c.parse_event(copy.deepcopy(EXAMPLES["judge"][1]))
    results = model.results  # type: ignore[attr-defined]
    assert isinstance(results["interrupted"], c.NoulAnswer)
    assert isinstance(results["tone"], c.ChoiceAnswer)
    assert isinstance(results["clarity"], c.ScoreAnswer)


def test_coach_question_kinds() -> None:
    model = c.parse_event(copy.deepcopy(EXAMPLES["coach.activated"][1]))
    questions = model.coach.questions  # type: ignore[attr-defined]
    assert isinstance(questions["interrupted"], c.NoulQuestion)
    assert isinstance(questions["tone"], c.ChoiceQuestion)
    assert isinstance(questions["clarity"], c.ScoreQuestion)


def test_unknown_type_raises() -> None:
    with pytest.raises(ValidationError):
        c.parse_event({"type": "not.a.real.event", "session_id": "s-001"})


def test_missing_field_raises() -> None:
    bad = copy.deepcopy(EXAMPLES["turn.final"][1])
    del bad["turn_id"]
    with pytest.raises(ValidationError):
        c.parse_event(bad)


def test_extra_field_raises() -> None:
    bad = {**EXAMPLES["session.ended"][1], "surprise": 1}
    with pytest.raises(ValidationError):
        c.parse_event(bad)


def test_extra_field_in_nested_model_raises() -> None:
    bad = copy.deepcopy(EXAMPLES["debrief"][1])
    bad["data"]["numbers"]["volume_db"] = -20.0
    with pytest.raises(ValidationError):
        c.parse_event(bad)


def test_session_started_ts_must_be_zero() -> None:
    bad = {**EXAMPLES["session.started"][1], "ts": 5}
    with pytest.raises(ValidationError):
        c.parse_event(copy.deepcopy(bad))


def test_bad_haptic_pattern_raises() -> None:
    bad = {**EXAMPLES["nudge"][1], "haptic": "buzz"}
    with pytest.raises(ValidationError):
        c.parse_event(bad)


# ---------- REST models ----------
REST_EXAMPLES: dict[str, tuple[type[BaseModel], dict[str, Any]]] = {
    "HapticCommand": (c.HapticCommand, {
        "type": "haptic", "pattern": "slow_down", "intensity": 0.6, "label": "Slow down",
        "source_app": "undertone",
    }),
    "HabitProfile": (c.HabitProfile, {
        "sessions": 12, "baseline_wpm": 148.0, "baseline_volume_db": -23.0,
        "crutch_words": [{"word": "basically", "per_min": 1.4}, {"word": "um", "per_min": 2.2}],
        "recurring_issues": [
            {"rule_id": "interrupt", "label": "Interrupting", "rate": 0.4, "trend": "better"},
            {"rule_id": "monologue", "label": "Long monologues", "rate": 0.2, "trend": "worse"},
        ],
    }),
    "SessionSummary": (c.SessionSummary, {
        "session_id": "s-001", "started_at": "2026-11-14T09:30:00Z", "duration_s": 1260.0,
        "coach_name": "Better Listener", "mode": "practice", "person_id": "p-sam",
        "headline_fact": "You talked 62% of the time.", "numbers": NUMBERS,
    }),
    "DailyMission": (c.DailyMission, {
        "date": "2026-11-14", "focus_rule_id": "questions",
        "text": "Ask 3 open questions before your second story",
        "if_then": "When you finish a story, ask a question.", "target": 3.0, "progress": 1.0,
        "done": False,
        "suggestions": [
            {"focus_rule_id": "interrupt", "text": "Let Sam finish every sentence"},
            {"focus_rule_id": "filler", "text": "Pause instead of saying um"},
        ],
    }),
    "Streak": (c.Streak, {
        "days": 4, "freeze_available": True, "week": [True, True, False, True, True, False, False],
    }),
    "Person": (c.Person, {
        "person_id": "p-sam", "name": "Sam", "sessions": 5,
        "pattern": "You interrupt Sam 3x more than anyone",
        "brief": "Last time you talked 70%. Ask about his trip.",
    }),
    "WeeklyReport": (c.WeeklyReport, {
        "week_of": "2026-11-09",
        "trend": [
            {"metric": "wpm", "from": 150.0, "to": 140.0},
            {"metric": "interruptions", "from": 5.0, "to": 2.0},
        ],
        "best_session_id": "s-001", "biggest_improvement": "Interruptions down 60%",
    }),
}


@pytest.mark.parametrize("name", sorted(REST_EXAMPLES))
def test_rest_model_round_trip(name: str) -> None:
    cls, example = REST_EXAMPLES[name]
    model = cls.model_validate(copy.deepcopy(example))
    assert model.model_dump(mode="json", by_alias=True) == example


def test_trend_point_uses_wire_aliases() -> None:
    point = c.TrendPoint.model_validate({"metric": "wpm", "from": 150, "to": 140})
    assert point.from_ == 150
    assert point.to_ == 140
    assert point.model_dump(by_alias=True) == {"metric": "wpm", "from": 150, "to": 140}


def test_weekly_report_trend_dumps_wire_keys() -> None:
    report = c.WeeklyReport.model_validate({
        "week_of": "2026-11-09", "trend": [{"metric": "wpm", "from": 150, "to": 140}],
        "best_session_id": None, "biggest_improvement": "Pace closer to baseline",
    })
    dumped = report.model_dump(mode="json", by_alias=True)
    assert dumped["trend"] == [{"metric": "wpm", "from": 150, "to": 140}]


def test_trend_point_rejects_unknown_metric() -> None:
    with pytest.raises(ValidationError):
        c.TrendPoint.model_validate({"metric": "volume_db", "from": 1, "to": 2})
