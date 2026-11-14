"""Tests for the Gemini Decisions judge path. No network calls: clients are fakes."""

from __future__ import annotations

import asyncio
import dataclasses
import time
from types import SimpleNamespace
from typing import Any

import pytest

from backend import config, judge
from backend.contracts import (
    ChoiceAnswer, ChoiceQuestion, CoachSpec, Drill, NoulAnswer, NoulQuestion, NudgePolicy,
    ScoreAnswer, ScoreQuestion, TurnContext, TurnFinalEvent,
)
from backend.judge import decisions
from backend.judge.core_questions import CORE_QUESTIONS


# ---------- fixtures / helpers ----------
def make_coach(questions: dict[str, Any] | None = None) -> CoachSpec:
    return CoachSpec(
        id="c", name="Coach", goal="g", kind="custom", confidence_threshold=0.7,
        questions=questions or {}, nudge_policy=NudgePolicy(focus_rule_id="interrupted"),
        drill=Drill(partner_persona="p"),
    )


def make_ctx(*, gap: float | None = 0.5, other_text: str = "How would you approach it?") -> TurnContext:
    prev = None
    start = 10.0
    if gap is not None:
        prev = TurnFinalEvent(turn_id="o1", speaker="other", text=other_text, start=2.0, end=start - gap,
                              wpm=150)
    turn = TurnFinalEvent(turn_id="m1", speaker="me", text="I'd start with revenue. How do you define success?",
                          start=start, end=start + 6, wpm=140)
    return TurnContext(turn=turn, prev_other_turn=prev, motion_summary="hands: still")


def with_settings(monkeypatch: pytest.MonkeyPatch, **kw: Any) -> None:
    monkeypatch.setattr(config, "settings", dataclasses.replace(config.settings, **kw))


class FakeClient:
    """Mimics client.aio.decisions.create."""

    def __init__(self, behaviour: Any) -> None:
        self.calls: list[dict[str, Any]] = []
        self._behaviour = behaviour
        self.aio = SimpleNamespace(decisions=SimpleNamespace(create=self._create))

    async def _create(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        return await self._behaviour(**kwargs)


def ns_noul(p: float, c: float = 0.8) -> SimpleNamespace:
    return SimpleNamespace(type="noul", noul=p, confidence=c)


def ns_choice(choice: str, probs: dict[str, float], c: float = 0.7) -> SimpleNamespace:
    return SimpleNamespace(type="choice", choice=choice, probabilities=probs, confidence=c)


def ns_score(score: float, c: float = 0.6) -> SimpleNamespace:
    return SimpleNamespace(type="score", score=score, legend=None, probabilities={}, confidence=c)


@pytest.fixture(autouse=True)
def _reset_client() -> Any:
    decisions.reset_client()
    yield
    decisions.reset_client()


# ---------- map_answers ----------
def test_map_answers_sdk_objects_all_types() -> None:
    raw = {
        "hedging": ns_noul(0.73),
        "tone": ns_choice("warm", {"warm": 0.6, "flat": 0.4}),
        "clarity": ns_score(3.2),
    }
    out = decisions.map_answers(raw, dict(CORE_QUESTIONS))
    assert out["hedging"] == NoulAnswer(p=0.73, confidence=0.8)
    assert out["tone"] == ChoiceAnswer(choice="warm", probabilities={"warm": 0.6, "flat": 0.4}, confidence=0.7)
    assert out["clarity"] == ScoreAnswer(score=4.2, max=5, confidence=0.6)


def test_map_answers_plain_dicts() -> None:
    raw = {
        "hedging": {"type": "noul", "noul": 0.2, "confidence": 0.9},
        "tone": {"type": "choice", "choice": "flat", "probabilities": {"flat": 1.0}, "confidence": 0.5},
        "clarity": {"type": "score", "score": 0.0, "confidence": 0.4},
    }
    out = decisions.map_answers(raw, dict(CORE_QUESTIONS))
    assert out["hedging"].p == 0.2
    assert out["tone"].choice == "flat"
    assert out["clarity"] == ScoreAnswer(score=1.0, max=5, confidence=0.4)


@pytest.mark.parametrize(("raw", "expected"), [(0.0, 1.0), (4.0, 5.0), (2.5, 3.5)])
def test_score_is_one_based(raw: float, expected: float) -> None:
    out = decisions.map_answers({"clarity": ns_score(raw)}, dict(CORE_QUESTIONS))
    assert out["clarity"].score == expected
    assert out["clarity"].max == 5


def test_score_max_follows_coach_criteria_length() -> None:
    qs = {"warmth": ScoreQuestion(instructions="x", criteria=["a", "b", "c", "d"])}
    out = decisions.map_answers({"warmth": ns_score(3.0)}, qs)
    assert out["warmth"] == ScoreAnswer(score=4.0, max=4, confidence=0.6)


def test_noul_clamped() -> None:
    out = decisions.map_answers({"hedging": ns_noul(1.0), "rambling": ns_noul(0.0)}, dict(CORE_QUESTIONS))
    assert out["hedging"].p == 0.99
    assert out["rambling"].p == 0.01


def test_unknown_mismatched_and_malformed_skipped() -> None:
    raw = {
        "nope": ns_noul(0.5),                       # unknown qid
        "tone": ns_noul(0.5),                       # type mismatch (tone is choice)
        "clarity": SimpleNamespace(type="score"),   # malformed: no score
        "hedging": ns_noul(0.4),
    }
    out = decisions.map_answers(raw, dict(CORE_QUESTIONS))
    assert set(out) == {"hedging"}


# ---------- merge_questions ----------
def test_merge_questions_coach_wins_adds_and_skips_bad_choice() -> None:
    override = NoulQuestion(instructions="custom hedging")
    coach = make_coach({
        "hedging": override,
        "jargon": NoulQuestion(instructions="jargon?"),
        "bad": ChoiceQuestion(instructions="one option", criteria={"only": "x"}),
    })
    merged = decisions.merge_questions(coach)
    assert merged["hedging"] == override
    assert "jargon" in merged
    assert "bad" not in merged
    assert set(CORE_QUESTIONS) <= set(merged)
    payload = decisions.questions_payload(merged)
    assert payload["jargon"] == {"type": "noul", "instructions": "jargon?"}


# ---------- judge_turn ----------
async def test_slow_client_falls_back_within_deadline(monkeypatch: pytest.MonkeyPatch) -> None:
    async def slow(**_: Any) -> Any:
        await asyncio.sleep(5)

    fake = FakeClient(slow)
    with_settings(monkeypatch, gemini_api_key="test-key", use_rule_judge_only=False)
    monkeypatch.setattr(decisions, "get_client", lambda: fake)
    t0 = time.perf_counter()
    ev = await judge.judge_turn(make_ctx(), make_coach())
    elapsed = time.perf_counter() - t0
    assert ev.source == "rules"
    assert elapsed < 1.0
    assert ev.latency_ms >= 700
    assert fake.calls and fake.calls[0]["model"] == decisions.MODEL


async def test_raising_client_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    async def boom(**_: Any) -> Any:
        raise RuntimeError("HTTP 500")

    with_settings(monkeypatch, gemini_api_key="test-key", use_rule_judge_only=False)
    monkeypatch.setattr(decisions, "get_client", lambda: FakeClient(boom))
    ev = await judge.judge_turn(make_ctx(), make_coach())
    assert ev.source == "rules"
    assert set(CORE_QUESTIONS) <= set(ev.results)


@pytest.mark.parametrize("kw", [{"gemini_api_key": None}, {"gemini_api_key": "k", "use_rule_judge_only": True}])
async def test_rules_only_never_calls_client(monkeypatch: pytest.MonkeyPatch, kw: dict[str, Any]) -> None:
    async def fail(**_: Any) -> Any:
        raise AssertionError("client must not be called")

    fake = FakeClient(fail)
    with_settings(monkeypatch, **kw)
    monkeypatch.setattr(decisions, "get_client", lambda: fake)
    ev = await judge.judge_turn(make_ctx(), make_coach())
    assert ev.source == "rules"
    assert fake.calls == []


async def test_fast_client_partial_answers_filled_from_rules(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fast(**kwargs: Any) -> Any:
        assert set(CORE_QUESTIONS) <= set(kwargs["questions"])
        return SimpleNamespace(answers={"hedging": ns_noul(0.66), "clarity": ns_score(2.0)}, usage=None)

    fake = FakeClient(fast)
    with_settings(monkeypatch, gemini_api_key="test-key", use_rule_judge_only=False)
    monkeypatch.setattr(decisions, "get_client", lambda: fake)
    ev = await judge.judge_turn(make_ctx(), make_coach())
    assert ev.source == "decisions"
    assert ev.results["hedging"].p == 0.66
    assert ev.results["clarity"] == ScoreAnswer(score=3.0, max=5, confidence=0.6)
    assert set(CORE_QUESTIONS) <= set(ev.results)  # missing ids filled by rules
    assert fake.calls[0]["timeout"] > 0
    assert ev.latency_ms >= 0


async def test_empty_answers_fall_back(monkeypatch: pytest.MonkeyPatch) -> None:
    async def empty(**_: Any) -> Any:
        return SimpleNamespace(answers={})

    with_settings(monkeypatch, gemini_api_key="test-key", use_rule_judge_only=False)
    monkeypatch.setattr(decisions, "get_client", lambda: FakeClient(empty))
    ev = await judge.judge_turn(make_ctx(), make_coach())
    assert ev.source == "rules"


async def test_decide_without_client_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(decisions, "get_client", lambda: None)
    with pytest.raises(decisions.DecisionsUnavailable):
        await decisions.decide("x", dict(CORE_QUESTIONS))


# ---------- format_input ----------
def test_format_input_no_prev_turn() -> None:
    text = judge.format_input(make_ctx(gap=None))
    assert "OTHER PERSON (previous turn): none" in text
    assert "WEARER (turn being judged): I'd start" in text
    assert "TIMING" not in text
    assert "MOTION: hands: still" in text


def test_format_input_overlap_gap_and_immediate() -> None:
    overlap = judge.format_input(make_ctx(gap=-0.6))
    assert "TIMING: the wearer started 0.6 s before the other person finished." in overlap
    gap = judge.format_input(make_ctx(gap=1.2))
    assert "TIMING: the wearer started 1.2 s after the other person finished." in gap
    immediate = judge.format_input(make_ctx(gap=0.05))
    assert "immediately as the other person stopped" in immediate
    assert "OTHER PERSON (previous turn): How would you approach it?" in gap
    assert "10.0" not in gap  # no timestamps in text


def test_format_input_unknown_motion() -> None:
    ctx = make_ctx().model_copy(update={"motion_summary": ""})
    assert "MOTION: unknown" in judge.format_input(ctx)


# ---------- warm_up ----------
async def test_warm_up_false_without_key(monkeypatch: pytest.MonkeyPatch) -> None:
    with_settings(monkeypatch, gemini_api_key=None)
    assert await judge.warm_up() is False


async def test_warm_up_never_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    async def boom(**_: Any) -> Any:
        raise RuntimeError("down")

    with_settings(monkeypatch, gemini_api_key="test-key", use_rule_judge_only=False)
    monkeypatch.setattr(decisions, "get_client", lambda: FakeClient(boom))
    assert await judge.warm_up() is False


async def test_warm_up_true_on_success(monkeypatch: pytest.MonkeyPatch) -> None:
    async def ok(**kwargs: Any) -> Any:
        assert len(kwargs["questions"]) == 1
        return SimpleNamespace(answers={"warm": ns_noul(0.9)})

    with_settings(monkeypatch, gemini_api_key="test-key", use_rule_judge_only=False)
    monkeypatch.setattr(decisions, "get_client", lambda: FakeClient(ok))
    assert await judge.warm_up() is True
