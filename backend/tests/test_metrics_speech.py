"""Unit tests for backend.metrics.speech (pace, talk ratio, filler rate)."""

from __future__ import annotations

from backend.contracts import Speaker, TurnFinalEvent
from backend.metrics.speech import (
    baseline_from_first,
    fillers_per_min,
    rolling_wpm,
    talk_ratio,
    window_wpm,
)

FILLERS: tuple[str, ...] = ("um", "uh", "like", "you know")


def words(n: int) -> str:
    return " ".join(["word"] * n)


def turn(speaker: Speaker, start: float, end: float, text: str, tid: str = "t") -> TurnFinalEvent:
    return TurnFinalEvent(turn_id=tid, speaker=speaker, text=text, start=start, end=end, wpm=0.0)


TWO_ME = (
    turn("me", 0.0, 10.0, words(20), "a"),
    turn("me", 20.0, 30.0, words(40), "b"),
)


# ---------- talk_ratio ----------
def test_talk_ratio_basic() -> None:
    turns = [turn("me", 0, 30, words(5)), turn("other", 30, 40, words(5))]
    assert talk_ratio(turns) == 0.75


def test_talk_ratio_until_clips() -> None:
    turns = [turn("me", 0, 30, words(5)), turn("other", 30, 40, words(5))]
    assert talk_ratio(turns, until=35.0) == round(30 / 35, 3)
    assert talk_ratio(turns, until=20.0) == 1.0


def test_talk_ratio_no_speech() -> None:
    assert talk_ratio([]) == 0.0
    assert talk_ratio([turn("me", 5, 5, words(3))]) == 0.0
    assert talk_ratio([turn("other", 0, 10, "x")], until=0.0) == 0.0


# ---------- rolling_wpm ----------
def test_rolling_wpm_single_turn() -> None:
    assert rolling_wpm([turn("me", 0, 10, words(25))], at=10.0) == 150.0


def test_rolling_wpm_spans_two_turns() -> None:
    # 40 words from turn b + half of turn a (10 words) over 15 s of speech
    assert rolling_wpm(TWO_ME, at=30.0, window_s=15.0) == 200.0


def test_rolling_wpm_clips_to_at() -> None:
    assert rolling_wpm(TWO_ME[:1], at=5.0) == 120.0


def test_rolling_wpm_carries_through_silence() -> None:
    assert rolling_wpm(TWO_ME, at=100.0) == 200.0


def test_rolling_wpm_ignores_other_and_before_speech() -> None:
    turns = [*TWO_ME, turn("other", 30, 40, words(100))]
    assert rolling_wpm(turns, at=40.0) == 200.0
    assert rolling_wpm(TWO_ME, at=0.0) == 0.0
    assert rolling_wpm([], at=10.0) == 0.0


def test_rolling_wpm_short_speech_uses_available() -> None:
    # only 4 s of speech, 10 words -> 150 wpm
    assert rolling_wpm([turn("me", 0, 4, words(10))], at=10.0) == 150.0


def test_rolling_wpm_unsorted_input() -> None:
    assert rolling_wpm(tuple(reversed(TWO_ME)), at=30.0) == 200.0


def test_rolling_wpm_zero_duration_turn_ignored() -> None:
    turns = [*TWO_ME, turn("me", 30, 30, words(50))]
    assert rolling_wpm(turns, at=30.0) == 200.0


# ---------- window_wpm ----------
def test_window_wpm_clips_range() -> None:
    # [5, 25]: 10 words from a (5 s) + 20 words from b (5 s) -> 30 / (10/60) = 180
    assert window_wpm(TWO_ME, 5.0, 25.0) == 180.0


def test_window_wpm_too_little_speech() -> None:
    assert window_wpm(TWO_ME, 9.0, 21.0) is None  # only 2 s of speech
    assert window_wpm(TWO_ME, 10.0, 20.0) is None
    # 1 s of a (2 words) + 1 s of b (4 words) -> 6 / (2/60) = 180
    assert window_wpm(TWO_ME, 9.0, 21.0, min_speech_s=2.0) == 180.0


# ---------- baseline_from_first ----------
def test_baseline_none_until_enough_speech() -> None:
    assert baseline_from_first(TWO_ME) is None
    assert baseline_from_first([]) is None


def test_baseline_prorates_crossing_turn() -> None:
    turns = [*TWO_ME, turn("me", 40, 60, words(60), "c")]
    # 20 + 40 + half of c (30 words) = 90 words over 30 s -> 180 wpm
    assert baseline_from_first(turns) == 180.0


def test_baseline_unsorted_and_ignores_other() -> None:
    turns = [turn("me", 40, 60, words(60), "c"), turn("other", 0, 100, words(500)), *TWO_ME]
    assert baseline_from_first(turns) == 180.0


def test_baseline_custom_first_s() -> None:
    assert baseline_from_first(TWO_ME, first_s=10.0) == 120.0


# ---------- fillers_per_min ----------
def test_fillers_short_first_turn_uses_min_speech() -> None:
    turns = [turn("me", 0, 4, "um so we start here")]
    assert fillers_per_min(turns, FILLERS, at=4.0) == 4.0


def test_fillers_long_speech() -> None:
    turns = [turn("me", 0, 30, "um uh like, um " + words(20))]
    # 4 fillers over 30 s -> 8 per min
    assert fillers_per_min(turns, FILLERS, at=30.0) == 8.0


def test_fillers_window_clipping_prorates() -> None:
    turns = [
        turn("me", 0, 40, "um uh um uh " + words(20), "a"),
        turn("me", 60, 80, "um um " + words(10), "b"),
    ]
    # range [20, 80]: half of a (2 fillers, 20 s) + all of b (2 fillers, 20 s) -> 4 / (40/60) = 6
    assert fillers_per_min(turns, FILLERS, at=80.0, window_s=60.0) == 6.0


def test_fillers_uses_text_not_turn_fillers() -> None:
    t = TurnFinalEvent(turn_id="x", speaker="me", text=words(10), start=0, end=30,
                       wpm=0.0, fillers=["um", "um"])
    assert fillers_per_min([t], FILLERS, at=30.0) == 0.0


def test_fillers_no_wearer_speech() -> None:
    assert fillers_per_min([], FILLERS, at=10.0) == 0.0
    assert fillers_per_min([turn("other", 0, 30, "um um")], FILLERS, at=30.0) == 0.0
    assert fillers_per_min([turn("me", 0, 10, "um")], FILLERS, at=200.0) == 0.0
    assert fillers_per_min([turn("me", 5, 5, "um")], FILLERS, at=5.0) == 0.0


def test_fillers_rounds_two_dp() -> None:
    turns = [turn("me", 0, 21, "um " + words(10))]
    assert fillers_per_min(turns, FILLERS, at=21.0) == round(1 / (21 / 60), 2)
