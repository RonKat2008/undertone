"""MetricsEngine integration: each metric through the public API, fusion signals, the fixture."""

from __future__ import annotations

import json
import math

from backend.config import FIXTURES_DIR
from backend.contracts import (
    ChoiceAnswer, JudgeEvent, MotionEvent, NoulAnswer, TranscriptPartialEvent, TurnFinalEvent,
    parse_event,
)
from backend.metrics import MetricsEngine, find_fillers

FILLERS = ["um", "uh", "like", "basically", "you know", "actually", "sort of", "kind of",
           "i mean", "literally"]


def _engine(baseline_wpm: float | None = None, baseline_db: float | None = None) -> MetricsEngine:
    return MetricsEngine(baseline_wpm, baseline_db, FILLERS)


def _turn(tid: str, speaker: str, start: float, end: float, text: str) -> TurnFinalEvent:
    return TurnFinalEvent(turn_id=tid, speaker=speaker, text=text, start=start, end=end, wpm=0.0)  # type: ignore[arg-type]


def _words(n: int, word: str = "word") -> str:
    return " ".join([word] * n)


def _judge(tid: str, interrupted: float = 0.0, question: float = 0.0) -> JudgeEvent:
    return JudgeEvent(turn_id=tid, latency_ms=1.0, source="rules", results={
        "interrupted": NoulAnswer(p=interrupted, confidence=0.9),
        "asked_question": NoulAnswer(p=question, confidence=0.9),
    })


def _motion(ts: float, state: str, energy: float, ctx: str | None = None) -> MotionEvent:
    return MotionEvent(state=state, hand_energy=energy, speaker_context=ctx, confidence=0.8, ts=ts)  # type: ignore[arg-type]


def test_talk_ratio_by_speaking_time() -> None:
    e = _engine()
    e.add_turn(_turn("a", "me", 0, 30, _words(75)))
    e.add_turn(_turn("b", "other", 30, 40, _words(25)))
    assert e.snapshot(40).talk_ratio == 0.75


def test_interruptions_and_questions_from_judge_without_double_count() -> None:
    e = _engine()
    e.note_judge(_judge("t1", interrupted=0.85, question=0.7))
    e.note_judge(_judge("t1", interrupted=0.9, question=0.65))  # re-judged: same turn
    e.note_judge(_judge("t2", interrupted=0.79, question=0.59))
    e.note_judge(JudgeEvent(turn_id="t3", latency_ms=1, source="rules", results={
        "interrupted": ChoiceAnswer(choice="yes", probabilities={"yes": 1.0}, confidence=1.0)}))
    snap = e.snapshot(10)
    assert (snap.interruptions, snap.questions) == (1, 1)


def test_fillers_per_min_uses_wearer_speech_and_coach_words() -> None:
    e = _engine()
    # 30 s of wearer speech with 3 fillers ("um", "you know", "like,"), "I like" is not one
    e.add_turn(_turn("a", "me", 0, 30, "Um I like tea, you know, and, like, coffee " + _words(60)))
    e.add_turn(_turn("b", "other", 30, 60, "um um um um " + _words(70)))  # other's fillers ignored
    assert e.snapshot(30).fillers_per_min == 6.0
    assert e.fillers_for("Um, I like it, like, a lot") == ["um", "like"]
    assert find_fillers("you know what", FILLERS) == ["you know"]


def test_wpm_rolling_and_baseline_passthrough() -> None:
    e = _engine(baseline_wpm=140.0)
    e.add_turn(_turn("a", "me", 0, 10, _words(25)))
    snap = e.snapshot(10)
    assert (snap.wpm, snap.baseline_wpm) == (150.0, 140.0)
    assert e.snapshot(60).wpm == 150.0  # carried through silence


def test_session_baseline_established_from_first_30_s_when_unknown() -> None:
    e = _engine(baseline_wpm=None)
    e.add_turn(_turn("a", "me", 0, 20, _words(40)))  # 120 wpm
    assert e.snapshot(20).baseline_wpm is None
    e.add_turn(_turn("b", "me", 25, 45, _words(60)))  # 180 wpm; first 10 s of it -> 30 words
    assert e.snapshot(45).baseline_wpm == 140.0  # (40 + 30) words / 0.5 min


def test_monologue_grows_live_from_partials_and_resets_on_other() -> None:
    e = _engine()
    e.add_turn(_turn("o", "other", 0, 10, _words(20)))
    for t in range(11, 41):
        e.add_partial(TranscriptPartialEvent(speaker="me", text="growing"), float(t))
        e.snapshot(float(t))
    assert e.snapshot(40.5).monologue_s == 30.5  # run started at 10 (max(other end, 11 - 1))
    assert e.snapshot(50).monologue_s == 30.0  # partials stale: holds at last activity
    e.add_turn(_turn("m", "me", 11, 41, _words(60)))
    assert e.snapshot(50).monologue_s == 31.0
    e.add_partial(TranscriptPartialEvent(speaker="other", text="ok"), 51.0)
    assert e.snapshot(51).monologue_s == 0.0
    assert e.peak_monologue_s == 31.0


def test_volume_rolling_mean_and_state_vs_baseline() -> None:
    e = _engine(baseline_db=-30.0)
    assert e.snapshot(0).volume_db == -30.0  # no samples yet: baseline
    for i in range(4):
        e.add_volume(-22.0, 10.0 + i * 0.5)
    snap = e.snapshot(11.5)
    assert (snap.volume_db, snap.volume_state) == (-22.0, "loud")
    for i in range(6):
        e.add_volume(-26.0, 12.0 + i * 0.5)
    assert e.snapshot(15.0).volume_state == "loud"  # inside the dead band: no flicker
    e.add_volume(-29.0, 20.0)
    assert e.snapshot(20.0).volume_state == "ok"
    e.add_volume(-75.0, 21.0)  # silence is ignored
    assert e.snapshot(21.0).volume_db == -29.0


def test_volume_uses_session_baseline_when_unknown() -> None:
    e = _engine(baseline_db=None)
    for t in range(0, 31):
        e.add_volume(-30.0, float(t))
        e.snapshot(float(t))
    for t in range(31, 35):
        e.add_volume(-40.0, float(t))
    assert e.snapshot(34).volume_state == "quiet"


def test_hand_energy_smoothed() -> None:
    e = _engine()
    e.add_motion(_motion(0.0, "gesture", 0.5, "me"))
    e.add_motion(_motion(3.0, "fidget", 1.0, "me"))
    expected = round(0.5 + (1 - math.exp(-1.0)) * 0.5, 3)
    assert e.snapshot(3.0).hand_energy == expected


def test_timeline_every_5_s_with_zero_wpm_before_speech() -> None:
    e = _engine()
    e.add_turn(_turn("o", "other", 0, 10, _words(20)))
    e.add_turn(_turn("m", "me", 10, 20, _words(25)))
    e.add_motion(_motion(22.0, "still", 0.1))
    points = e.timeline()
    assert [p.t for p in points] == [0.0, 5.0, 10.0, 15.0, 20.0]
    assert [p.wpm for p in points] == [0.0, 0.0, 0.0, 150.0, 150.0]


def test_fidget_while_other_and_signals() -> None:
    e = _engine(baseline_wpm=120.0)
    for ts in (1.0, 3.0, 5.0, 7.0, 9.5):
        e.add_motion(_motion(ts, "fidget", 0.7, "other"))
    assert e.fidget_while_other_s(9.5) == 8.5
    # nerves: frozen hands + 200 wpm (> 1.25 * 120) inside the same 10 s
    e.add_turn(_turn("m", "me", 12, 20, _words(28)))  # 210 wpm
    e.add_motion(_motion(15.0, "still", 0.05, "me"))
    e.add_motion(_motion(19.0, "still", 0.08, "me"))
    assert e.nerves(20.0) is True
    kinds = [s.kind for s in e.detect_signals(20.0)]
    assert kinds == ["nerves"]
    assert e.detect_signals(21.0) == []  # cooldown: not repeated every tick


def test_checked_out_after_long_still_stretch_of_other_talking() -> None:
    e = _engine()
    e.add_turn(_turn("m", "me", 0, 5, "Tell me about the trip?"))
    for t in range(6, 42):
        e.add_partial(TranscriptPartialEvent(speaker="other", text="..."), float(t))
        if t % 3 == 0:
            e.add_motion(_motion(float(t), "still", 0.05, "other"))
        if t == 20:
            assert e.checked_out(20.0) is False  # only 15 s of the other person so far
    assert e.checked_out(41.0) is True
    assert [s.kind for s in e.detect_signals(41.0)] == ["checked_out"]
    e2 = _engine()
    for t in range(6, 42):
        e2.add_partial(TranscriptPartialEvent(speaker="other", text="..."), float(t))
        if t % 3 == 0:
            e2.add_motion(_motion(float(t), "gesture", 0.5, "other"))
    assert e2.checked_out(41.0) is False


def test_snapshot_never_raises_on_bad_or_out_of_order_data() -> None:
    e = _engine()
    e.add_turn(_turn("b", "me", 50, 40, "backwards"))
    e.add_turn(_turn("a", "me", 5, 5, ""))
    e.add_volume(float("nan"), 3.0)
    e.add_motion(_motion(float("inf"), "still", float("nan")))
    e.add_partial(TranscriptPartialEvent(speaker=None, text="x"), 2.0)
    for now in (float("nan"), -5.0, 0.0, 1e9):
        e.snapshot(now)
    assert isinstance(e.timeline(), list)


def _replay_fixture(e: MetricsEngine) -> tuple[float, float]:
    """Drive the engine like brain.py: events at their `at`, judge on wearer turns, 1 Hz ticks."""
    rows = [json.loads(x) for x in (FIXTURES_DIR / "demo_session.jsonl").read_text().splitlines() if x.strip()]
    peak, tick, last = 0.0, 0.0, 0.0
    for row in rows:
        at = float(row.pop("at"))
        while tick <= at:
            peak = max(peak, e.snapshot(tick).monologue_s)
            tick += 1.0
        ev = parse_event(row)
        if isinstance(ev, TurnFinalEvent):
            e.add_turn(ev)
            if ev.speaker == "me":
                e.note_judge(_judge(ev.turn_id, question=0.9 if "?" in ev.text else 0.1))
        elif isinstance(ev, TranscriptPartialEvent):
            e.add_partial(ev, at)
        elif isinstance(ev, MotionEvent):
            e.add_motion(ev)
        peak = max(peak, e.snapshot(at).monologue_s)
        last = at
    return peak, last


def test_whole_fixture_gives_plausible_end_values() -> None:
    e = _engine(baseline_wpm=None)
    peak, last = _replay_fixture(e)
    snap = e.snapshot(last)
    assert snap.talk_ratio > 0.5
    assert peak > 45.0
    assert snap.fillers_per_min > 5.0
    assert snap.questions == 2
    assert 120.0 < snap.wpm < 200.0
    assert snap.baseline_wpm is not None
    assert 0.0 < snap.hand_energy <= 1.0
    points = e.timeline()
    assert len(points) == int(last // 5) + 1
    assert points[0].wpm == 0.0 and points[-1].wpm > 0.0


def test_live_pace_wins_while_fresh_then_falls_back():
    from backend.metrics import LIVE_PACE_FRESH_S, MetricsEngine
    m = MetricsEngine(None, None, ["um"])
    m.add_live_pace(212.0, 10.0)
    assert m.snapshot(11.0).wpm == 212.0
    assert m.snapshot(10.0 + LIVE_PACE_FRESH_S + 0.5).wpm == 0.0  # stale: back to turn-based (no turns)
    m.add_live_pace(float("nan"), 12.0)  # ignored
    assert m.snapshot(14.5).wpm == 0.0
