"""Tests for RunTracker (speaker run timer) and JudgeTally (judged interruptions/questions)."""

from __future__ import annotations

from backend.contracts import ChoiceAnswer, JudgeAnswer, JudgeEvent, NoulAnswer, TurnFinalEvent
from backend.metrics.judge_tally import INTERRUPTED_P, QUESTION_P, JudgeTally
from backend.metrics.runs import PARTIAL_FRESH_S, PARTIAL_LEAD_S, RunTracker


def _turn(turn_id: str, speaker: str, start: float, end: float) -> TurnFinalEvent:
    return TurnFinalEvent(turn_id=turn_id, speaker=speaker, text="x", start=start, end=end, wpm=150.0)


def _judge(turn_id: str, results: dict[str, JudgeAnswer]) -> JudgeEvent:
    return JudgeEvent(turn_id=turn_id, results=results, latency_ms=10.0, source="rules")


def _noul(p: float) -> NoulAnswer:
    return NoulAnswer(p=p, confidence=0.9)


# ---------- RunTracker ----------
def test_constants() -> None:
    assert PARTIAL_FRESH_S == 2.0
    assert PARTIAL_LEAD_S == 1.0
    assert INTERRUPTED_P == 0.8
    assert QUESTION_P == 0.6


def test_empty_tracker_is_zero() -> None:
    tracker = RunTracker("me")
    assert tracker.value(10.0) == 0.0
    assert tracker.run_start is None


def test_partials_grow_live_then_hold_when_stale() -> None:
    tracker = RunTracker("me")
    for t in range(22, 31):
        tracker.on_partial("me", float(t))
    assert tracker.run_start == 21.0
    assert tracker.value(30.0) == 9.0
    assert tracker.value(31.0) == 10.0
    assert tracker.value(40.0) == 9.0


def test_partial_run_starts_after_last_opposite_turn() -> None:
    tracker = RunTracker("me")
    tracker.on_turn(_turn("t03", "other", 17.0, 21.4))
    tracker.on_partial("me", 22.0)
    assert tracker.run_start == 21.4


def test_own_turn_after_opposite_without_partials() -> None:
    tracker = RunTracker("me")
    tracker.on_turn(_turn("t03", "other", 17.0, 21.4))
    tracker.on_turn(_turn("t04", "me", 20.7, 69.3))
    assert tracker.run_start == 21.4
    assert tracker.value(69.3) == 47.9


def test_own_turn_refines_partial_opened_run() -> None:
    tracker = RunTracker("me")
    tracker.on_partial("me", 5.0)  # run opens at 4.0
    tracker.on_turn(_turn("t01", "me", 2.5, 6.0))
    assert tracker.run_start == 2.5


def test_consecutive_own_turns_accumulate_then_reset_by_opposite_partial() -> None:
    tracker = RunTracker("me")
    tracker.on_turn(_turn("a", "me", 0.0, 10.0))
    tracker.on_turn(_turn("b", "me", 12.0, 20.0))
    assert tracker.value(20.0) == 20.0
    tracker.on_partial("other", 21.0)
    assert tracker.value(21.0) == 0.0
    assert tracker.run_start is None


def test_opposite_partial_clears_own_freshness() -> None:
    tracker = RunTracker("me")
    tracker.on_partial("me", 10.0)
    tracker.on_partial("other", 10.5)
    tracker.on_partial("me", 11.0)  # new run: max(10.5, 10.0) = 10.5
    assert tracker.run_start == 10.5
    assert tracker.value(11.5) == 1.0


def test_stale_opposite_turn_does_not_reset() -> None:
    tracker = RunTracker("me")
    tracker.on_turn(_turn("o1", "other", 0.0, 5.0))
    tracker.on_partial("me", 7.0)  # run opens at 6.0
    tracker.on_turn(_turn("o0", "other", 1.0, 4.0))  # ended before run start
    assert tracker.run_start == 6.0
    assert tracker.value(7.0) == 1.0


def test_opposite_turn_ending_after_run_start_closes_run() -> None:
    tracker = RunTracker("me")
    tracker.on_partial("me", 7.0)  # run opens at 6.0
    tracker.on_turn(_turn("o1", "other", 5.0, 8.0))
    assert tracker.run_start is None
    assert tracker.value(8.0) == 0.0


def test_out_of_order_own_turn_older_than_last_opposite_end_ignored() -> None:
    tracker = RunTracker("me")
    tracker.on_turn(_turn("o1", "other", 10.0, 20.0))
    tracker.on_turn(_turn("m0", "me", 2.0, 8.0))
    assert tracker.run_start is None
    assert tracker.value(20.0) == 0.0


def test_none_speaker_partial_ignored() -> None:
    tracker = RunTracker("me")
    tracker.on_partial(None, 5.0)
    assert tracker.run_start is None
    tracker.on_partial("me", 6.0)
    tracker.on_partial(None, 7.0)
    assert tracker.run_start == 5.0
    assert tracker.value(7.0) == 2.0


def test_other_speaker_tracker_mirrors() -> None:
    tracker = RunTracker("other")
    tracker.on_turn(_turn("o1", "other", 0.6, 10.9))
    assert tracker.value(10.9) == 10.3
    tracker.on_turn(_turn("m1", "me", 11.6, 16.4))
    assert tracker.value(16.4) == 0.0


def test_value_never_negative() -> None:
    tracker = RunTracker("me")
    tracker.on_partial("me", 10.0)
    assert tracker.value(5.0) == 1.0  # now before last partial -> not fresh, holds


# ---------- JudgeTally ----------
def test_tally_counts_two_turns() -> None:
    tally = JudgeTally()
    tally.note(_judge("t1", {"interrupted": _noul(0.9), "asked_question": _noul(0.7)}))
    tally.note(_judge("t2", {"interrupted": _noul(0.85)}))
    assert tally.interruptions == 2
    assert tally.questions == 1
    assert tally.question_turn_ids == frozenset({"t1"})


def test_tally_rejudge_counts_once() -> None:
    tally = JudgeTally()
    tally.note(_judge("t1", {"interrupted": _noul(0.9), "asked_question": _noul(0.9)}))
    tally.note(_judge("t1", {"interrupted": _noul(0.95), "asked_question": _noul(0.9)}))
    assert tally.interruptions == 1
    assert tally.questions == 1


def test_tally_thresholds_inclusive() -> None:
    tally = JudgeTally()
    tally.note(_judge("a", {"interrupted": _noul(0.8), "asked_question": _noul(0.6)}))
    tally.note(_judge("b", {"interrupted": _noul(0.79), "asked_question": _noul(0.59)}))
    assert tally.interruptions == 1
    assert tally.questions == 1


def test_tally_ignores_non_noul_and_missing() -> None:
    tally = JudgeTally()
    choice = ChoiceAnswer(choice="yes", probabilities={"yes": 1.0}, confidence=1.0)
    tally.note(_judge("a", {"interrupted": choice}))
    tally.note(_judge("b", {}))
    assert tally.interruptions == 0
    assert tally.questions == 0
    assert tally.question_turn_ids == frozenset()


def test_tally_rejudge_flip_removes_count() -> None:
    tally = JudgeTally()
    tally.note(_judge("a", {"interrupted": _noul(0.9), "asked_question": _noul(0.9)}))
    tally.note(_judge("a", {"interrupted": _noul(0.1), "asked_question": _noul(0.1)}))
    assert tally.interruptions == 0
    assert tally.questions == 0
    assert tally.question_turn_ids == frozenset()


def test_tally_tolerates_garbage() -> None:
    tally = JudgeTally()
    tally.note(None)  # type: ignore[arg-type]
    assert tally.interruptions == 0


def test_own_final_turn_stops_wall_clock_growth() -> None:
    tracker = RunTracker("me")
    for t in range(10, 21):
        tracker.on_partial("me", float(t))
    tracker.on_turn(TurnFinalEvent(turn_id="m", speaker="me", text="x", start=9.5, end=20.2, wpm=0.0))
    assert tracker.value(21.5) == 11.2  # holds at the turn's end, does not keep counting
    tracker.on_partial("me", 23.0)  # next turn starts streaming: grows again
    assert tracker.value(24.0) == 15.0
