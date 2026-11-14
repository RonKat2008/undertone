"""Unit tests for backend.metrics.volume and backend.metrics.hands (hand-computed values)."""

from __future__ import annotations

import math

import pytest

from backend.contracts import MotionEvent
from backend.metrics.hands import (
    FIDGET_GAP_S, FROZEN_ENERGY, SMOOTH_TAU_S, fidget_while_other_s,
    fidget_while_other_total_s, hands_frozen, mean_energy, smoothed_energy, smoothed_series,
)
from backend.metrics.volume import (
    BASELINE_SPAN_S, ENTER_DB, EXIT_DB, SILENCE_DB, SILENT_DB, VOLUME_WINDOW_S, bucket_db,
    next_volume_state, rolling_db, session_baseline_db,
)

NAN = float("nan")
INF = float("inf")


def ev(ts: float, energy: float = 0.5, state: str = "gesture",
       speaker: str | None = "me") -> MotionEvent:
    return MotionEvent(state=state, hand_energy=energy, speaker_context=speaker,  # type: ignore[arg-type]
                       confidence=0.9, ts=ts)


# ---------------------------------------------------------------- volume constants
def test_volume_constants() -> None:
    assert (SILENCE_DB, VOLUME_WINDOW_S, BASELINE_SPAN_S) == (-50.0, 3.0, 30.0)
    assert (ENTER_DB, EXIT_DB, SILENT_DB) == (6.0, 3.0, -60.0)


# ---------------------------------------------------------------- rolling_db
def test_rolling_db_empty() -> None:
    assert rolling_db([], 10.0) is None


def test_rolling_db_mean_in_window_unsorted() -> None:
    samples = [(9.0, -20.0), (6.0, -40.0), (8.0, -30.0), (7.0, -25.0)]
    # window [7, 10]: -25, -30, -20 -> -25.0 ; 6.0 is outside
    assert rolling_db(samples, 10.0) == -25.0


def test_rolling_db_inclusive_edges_and_rounding() -> None:
    samples = [(7.0, -21.0), (10.0, -22.0), (10.5, -10.0)]
    # window [7, 10] includes both edges, 10.5 is in the future
    assert rolling_db(samples, 10.0) == -21.5
    assert rolling_db([(1.0, -20.0), (2.0, -20.0), (3.0, -21.0)], 3.0) == -20.3


def test_rolling_db_excludes_silence_and_nonfinite() -> None:
    samples = [(9.0, -55.0), (9.5, NAN), (NAN, -10.0), (8.5, -30.0), (9.8, INF), (9.9, -60.0)]
    assert rolling_db(samples, 10.0) == -30.0


def test_rolling_db_holds_through_pause() -> None:
    samples = [(1.0, -30.0), (2.0, -28.0), (5.0, -55.0)]
    # nothing voiced in [17, 20] -> hold last voiced sample at or before 20
    assert rolling_db(samples, 20.0) == -28.0


def test_rolling_db_none_before_first_voiced() -> None:
    assert rolling_db([(5.0, -30.0), (1.0, -55.0)], 4.0) is None


def test_rolling_db_custom_window() -> None:
    samples = [(5.0, -40.0), (9.0, -20.0)]
    assert rolling_db(samples, 10.0, window_s=10.0) == -30.0


# ---------------------------------------------------------------- session_baseline_db
def test_baseline_empty_and_not_established() -> None:
    assert session_baseline_db([]) is None
    assert session_baseline_db([(2.0, -30.0), (20.0, -28.0), (31.9, -26.0)]) is None


def test_baseline_established() -> None:
    # first voiced at 2.0 (0.5 is silence); span ends 32.0; sample at 32.0 establishes it
    samples = [(32.0, -26.0), (0.5, -55.0), (2.0, -30.0), (20.0, -28.0), (40.0, -10.0)]
    # mean of -30, -28, -26 -> -28.0 ; 40.0 is after the span
    assert session_baseline_db(samples) == -28.0


def test_baseline_ignores_nonfinite_and_silence() -> None:
    samples = [(NAN, -1.0), (3.0, NAN), (3.0, -31.0), (10.0, -51.0), (40.0, -29.0)]
    # first voiced 3.0, span to 33.0, only -31.0 inside; established by 40.0
    assert session_baseline_db(samples) == -31.0


# ---------------------------------------------------------------- next_volume_state
def test_volume_state_none_inputs_keep_prev() -> None:
    assert next_volume_state("loud", None, -30.0) == "loud"
    assert next_volume_state("quiet", -20.0, None) == "quiet"
    assert next_volume_state("ok", None, None) == "ok"


@pytest.mark.parametrize(
    ("prev", "db", "expected"),
    [
        ("ok", -24.0, "ok"),       # delta 6.0 is not > 6
        ("ok", -23.9, "loud"),
        ("ok", -36.0, "ok"),
        ("ok", -36.1, "quiet"),
        ("loud", -26.9, "loud"),   # delta 3.1 > 3
        ("loud", -27.0, "ok"),     # delta 3.0
        ("loud", -40.0, "quiet"),  # big drop goes straight to quiet
        ("quiet", -33.1, "quiet"),
        ("quiet", -33.0, "ok"),
        ("quiet", -20.0, "loud"),  # big rise goes straight to loud
    ],
)
def test_volume_state_transitions(prev: str, db: float, expected: str) -> None:
    assert next_volume_state(prev, db, -30.0) == expected  # type: ignore[arg-type]


def _run_states(start: str, dbs: list[float], baseline: float) -> list[str]:
    states: list[str] = []
    state = start
    for db in dbs:
        state = next_volume_state(state, db, baseline)  # type: ignore[arg-type]
        states.append(state)
    return states


def test_volume_state_no_flicker_loud() -> None:
    assert _run_states("ok", [-23.5, -25.0, -26.9, -27.5, -25.0], -30.0) == [
        "loud", "loud", "loud", "ok", "ok"]


def test_volume_state_no_flicker_quiet() -> None:
    assert _run_states("ok", [-36.5, -35.0, -33.1, -32.5, -35.0], -30.0) == [
        "quiet", "quiet", "quiet", "ok", "ok"]


# ---------------------------------------------------------------- bucket_db
def test_bucket_db() -> None:
    samples = [(5.0, -20.0), (9.99, -30.0), (10.0, -5.0), (4.99, -1.0), (7.0, -55.0), (6.0, NAN)]
    assert bucket_db(samples, 5.0, 10.0) == -25.0
    assert bucket_db(samples, 20.0, 25.0) is None
    assert bucket_db([], 0.0, 5.0) is None
    assert bucket_db([(1.0, -20.0), (2.0, -20.0), (3.0, -21.0)], 0.0, 5.0) == -20.3


# ---------------------------------------------------------------- hands constants
def test_hands_constants() -> None:
    assert (SMOOTH_TAU_S, FIDGET_GAP_S, FROZEN_ENERGY) == (3.0, 5.0, 0.15)


# ---------------------------------------------------------------- smoothed_energy
def test_smoothed_energy_empty_and_before_first() -> None:
    assert smoothed_energy([], 5.0) == 0.0
    assert smoothed_energy([ev(3.0, 0.8)], 2.0) == 0.0


def test_smoothed_energy_hand_computed() -> None:
    events = [ev(3.0, 1.0), ev(0.0, 0.0)]  # unsorted on purpose
    alpha = 1 - math.exp(-1.0)  # dt 3 / tau 3 -> 0.632...
    assert smoothed_energy(events, 0.0) == 0.0
    assert smoothed_energy(events, 3.0) == round(alpha, 3) == 0.632
    assert smoothed_energy(events, 100.0) == 0.632  # holds after events stop


def test_smoothed_energy_three_events() -> None:
    events = [ev(0.0, 0.2), ev(3.0, 0.8), ev(6.0, 0.8)]
    a = 1 - math.exp(-1.0)
    e1 = 0.2 + a * (0.8 - 0.2)
    e2 = e1 + a * (0.8 - e1)
    assert smoothed_energy(events, 6.0) == round(e2, 3) == 0.719


def test_smoothed_energy_clamps_and_filters() -> None:
    events = [ev(0.0, 5.0), ev(1.0, NAN), ev(NAN, 0.0), ev(2.0, INF)]
    assert smoothed_energy(events, 10.0) == 1.0
    assert smoothed_energy([ev(0.0, -3.0)], 1.0) == 0.0


def test_smoothed_energy_same_timestamp() -> None:
    # dt 0 -> alpha 0, the second event at the same ts has no effect
    assert smoothed_energy([ev(1.0, 0.4), ev(1.0, 1.0)], 1.0) == 0.4


# ---------------------------------------------------------------- smoothed_series
def test_smoothed_series_matches_pointwise() -> None:
    events = [ev(4.2, 0.9), ev(0.5, 0.1), ev(1.7, 0.6), ev(9.0, 0.0), ev(2.0, NAN), ev(6.1, 0.3)]
    times = [0.0, 0.5, 1.0, 1.7, 3.0, 4.2, 5.0, 6.1, 8.9, 9.0, 15.0]
    assert smoothed_series(events, times) == [smoothed_energy(events, t) for t in times]


def test_smoothed_series_empty() -> None:
    assert smoothed_series([], [0.0, 1.0]) == [0.0, 0.0]
    assert smoothed_series([ev(1.0)], []) == []


# ---------------------------------------------------------------- fidget_while_other_s
FIDGET_TS: tuple[float, ...] = (1.0, 3.39, 5.61, 7.63, 9.69)


def _fidget_events() -> list[MotionEvent]:
    return [ev(t, 0.6, "fidget", "other") for t in reversed(FIDGET_TS)]


def test_fidget_streak_example() -> None:
    events = _fidget_events()
    assert fidget_while_other_s(events, 9.69) == 8.69
    assert fidget_while_other_s(events, 5.61) == 4.61
    assert fidget_while_other_s(events, 0.5) == 0.0
    broken = [*events, ev(11.76, 0.5, "gesture", "me")]
    assert fidget_while_other_s(broken, 12.0) == 0.0


def test_fidget_streak_stale_and_empty() -> None:
    assert fidget_while_other_s([], 3.0) == 0.0
    events = _fidget_events()
    assert fidget_while_other_s(events, 14.6) == 8.69  # 4.91 s old: still current
    assert fidget_while_other_s(events, 14.8) == 0.0   # 5.11 s old: stale


def test_fidget_streak_gap_breaks_streak() -> None:
    events = [ev(0.0, 0.6, "fidget", "other"), ev(6.0, 0.6, "fidget", "other"),
              ev(8.5, 0.6, "fidget", "other")]
    assert fidget_while_other_s(events, 9.0) == 2.5


def test_fidget_streak_requires_other_speaker() -> None:
    events = [ev(0.0, 0.6, "fidget", "other"), ev(2.0, 0.6, "fidget", "me"),
              ev(4.0, 0.6, "fidget", "other")]
    assert fidget_while_other_s(events, 4.0) == 0.0
    assert fidget_while_other_s([*events, ev(NAN, 0.6, "fidget", "other")], 4.0) == 0.0


# ---------------------------------------------------------------- fidget_while_other_total_s
def test_fidget_total() -> None:
    events = [*_fidget_events(), ev(11.76, 0.5, "gesture", "me"),
              ev(20.0, 0.6, "fidget", "other"), ev(21.5, 0.6, "fidget", "other"),
              ev(30.0, 0.6, "fidget", "other")]
    # 8.69 + 1.5 ; 21.5 -> 30.0 gap is too large
    assert fidget_while_other_total_s(events) == 10.19
    assert fidget_while_other_total_s(events, until=5.61) == 4.61
    assert fidget_while_other_total_s([]) == 0.0


# ---------------------------------------------------------------- hands_frozen
def test_hands_frozen() -> None:
    still_hi = ev(1.0, 0.9, "still")
    low_gesture = ev(2.0, 0.1, "gesture")
    active = ev(3.0, 0.5, "gesture")
    assert hands_frozen([low_gesture, still_hi], 0.0, 2.0) is True
    assert hands_frozen([active, still_hi], 1.0, 3.0) is False
    assert hands_frozen([active], 5.0, 9.0) is False  # no events in window
    assert hands_frozen([], 0.0, 1.0) is False
    assert hands_frozen([ev(1.0, FROZEN_ENERGY, "gesture")], 0.0, 1.0) is False
    assert hands_frozen([ev(NAN, 0.9, "gesture"), still_hi], 0.0, 5.0) is True


# ---------------------------------------------------------------- mean_energy
def test_mean_energy() -> None:
    events = [ev(3.0, 0.6), ev(1.0, 0.2), ev(2.0, 2.0), ev(2.5, NAN), ev(9.0, 0.1)]
    # in [1, 3]: 0.2, clamped 1.0, 0.6 -> 0.6
    assert mean_energy(events, 1.0, 3.0) == pytest.approx(0.6)
    assert mean_energy(events, 4.0, 8.0) is None
    assert mean_energy([], 0.0, 1.0) is None
