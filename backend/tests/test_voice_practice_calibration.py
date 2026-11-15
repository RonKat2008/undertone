"""Score calibration: typical answers land 55-85, only exceptional sets pass 90, never a free 100."""

from __future__ import annotations

from backend.contracts import PracticeAnswer
from backend.voice_practice.measure import AnswerRecord, TimedWord, measure_answer, totals
from backend.voice_practice.score import measured_scores, overall

FILLERS = ["um", "uh", "like", "you know", "basically"]

TYPICAL = [
    "So we built a wearable that um listens to your conversations and buzzes when you interrupt. It is for "
    "people who want to be better listeners, I think maybe managers mostly. We tested it with five people.",
    "It runs speech to text on the laptop and a small model judges each turn, then the phone buzzes. The "
    "hardest part was, the, the timing, getting the buzz under a second.",
    "Next we would um add more coaches and probably ship it to a few teams.",
]
SOLID = ("We built a wearable coach that buzzes when you interrupt someone. In tests with twelve people it caught "
         "nine in ten interruptions within a second. Speech goes to text on the laptop, a small model judges each "
         "turn, and the phone buzzes. Next we will ship it to three teams and measure fewer interruptions a week.")
SHAKY = "I guess, the, the app maybe sort of works, I think maybe, probably. " + SOLID


def answers(texts: list[str], step: float, starts: list[float], gap: float = 0.0) -> list[PracticeAnswer]:
    """Synthetic timed answers: words `step` s apart, each answer starting `starts[i]` s after the coach."""
    out, t = [], 0.0
    for i, (text, start) in enumerate(zip(texts, starts), start=1):
        words, w_t = [], t + start
        for j, w in enumerate(text.split()):
            words.append(TimedWord(w, w_t, w_t + step * 0.8))
            w_t += step + (gap if j == 5 else 0.0)
        out.append(measure_answer(AnswerRecord(i, "Q", "", tuple(words), coach_done_at=t), FILLERS))
        t = words[-1].end + 5.0
    return out


def scores(ans: list[PracticeAnswer]) -> dict[str, int]:
    return {s.measure: s.score for s in measured_scores(ans, totals(ans))}


def test_typical_answers_land_between_55_and_85() -> None:
    ans = answers(TYPICAL, 0.4, [2.8, 2.6, 3.0], gap=2.4)
    got = scores(ans)
    assert set(got) == {"pace", "fillers", "conciseness", "confidence", "responsiveness"}
    assert all(55 <= v <= 87 for v in got.values()), got
    assert 55 <= overall(measured_scores(ans, totals(ans))) <= 85


def test_only_exceptional_sets_pass_90_and_none_reach_100() -> None:
    five = answers([SOLID] * 5, 0.4, [1.0, 1.2, 0.9, 1.1, 1.0])
    got = scores(five)
    assert got["pace"] > 85 and got["fillers"] > 85 and got["responsiveness"] > 80, got
    assert all(v < 100 for v in got.values()), got
    one = scores(five[:1])
    assert all(v <= 85 for v in one.values()), one  # one answer is not enough evidence for a top score


def test_conciseness_penalises_thin_and_rambling_answers() -> None:
    thin = scores(answers(["Yes we built a little buzzer for talking."] * 3, 0.4, [1, 1, 1]))["conciseness"]
    good = scores(answers([SOLID] * 3, 0.4, [1, 1, 1]))["conciseness"]
    ramble = scores(answers([SOLID * 3] * 3, 0.45, [1, 1, 1]))["conciseness"]
    assert thin < good - 20 and ramble < good - 20, (thin, good, ramble)


def test_getting_started_prefers_a_short_breath() -> None:
    blurt = scores(answers([SOLID] * 3, 0.4, [0.05] * 3))["responsiveness"]
    breath = scores(answers([SOLID] * 3, 0.4, [1.2] * 3))["responsiveness"]
    slow = scores(answers([SOLID] * 3, 0.4, [6.0] * 3))["responsiveness"]
    assert blurt < breath and slow < breath < 100, (blurt, breath, slow)


def test_confidence_drops_with_hedges_restarts_and_pauses() -> None:
    clean = scores(answers([SOLID] * 3, 0.4, [1, 1, 1]))["confidence"]
    shaky = scores(answers([SHAKY] * 3, 0.4, [1, 1, 1], gap=3.0))["confidence"]
    assert shaky < clean - 20 and clean < 100, (clean, shaky)
