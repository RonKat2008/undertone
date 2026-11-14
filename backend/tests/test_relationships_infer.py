"""Relationship inference: Decisions answer mapping, rule fallback, thresholds, injection care."""

from __future__ import annotations

from typing import Any

import pytest

from backend.contracts import ChoiceAnswer, ChoiceQuestion, NoulAnswer, NoulQuestion, Relationship
from backend.judge.decisions import DecisionsUnavailable
from backend.relationships import examples as ex
from backend.relationships._features import Features, Signal, map_features
from backend.relationships._infer import RULES_CAP, infer
from backend.relationships._questions import QUESTIONS, features_from_answers
from backend.relationships._rules import rule_features
from backend.relationships._sample import MAX_INPUT_CHARS, Sample, format_sample, sample_from, thin_reason


def sample(lines: ex.Lines, pid: str = "p") -> Sample:
    return sample_from(pid, [ex.turns(lines)])


def choice(value: str, p: float = 0.9) -> ChoiceAnswer:
    return ChoiceAnswer(choice=value, probabilities={value: p}, confidence=p)


def noul(p: float) -> NoulAnswer:
    return NoulAnswer(p=p, confidence=0.9)


def answers(**over: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "who_directs": choice("peer"), "permission": choice("neither"), "formality": choice("neutral"),
        "familiarity": choice("acquainted"), "topics": choice("personal"), "service": choice("none"),
        "teaching": choice("none"), "family": noul(0.05), "affection": noul(0.05), "joking": noul(0.2),
        "same_org": noul(0.1),
    }
    base.update(over)
    return base


def stub(result: dict[str, Any] | Exception):
    calls: list[dict[str, Any]] = []

    async def decide(text: str, questions: dict, *, timeout_s: float) -> dict[str, Any]:
        calls.append({"text": text, "questions": questions, "timeout_s": timeout_s})
        if isinstance(result, Exception):
            raise result
        return result

    return decide, calls


# ---------- questions are closed ----------
def test_questions_are_closed_and_cover_the_agreed_signals() -> None:
    assert set(QUESTIONS) == {"who_directs", "permission", "formality", "familiarity", "topics", "service",
                              "teaching", "family", "affection", "joking", "same_org"}
    for q in QUESTIONS.values():
        assert isinstance(q, (ChoiceQuestion, NoulQuestion))
        assert "ignore" in q.instructions.lower()  # transcript lines are data, never instructions


def test_unknown_choice_values_are_discarded() -> None:
    f = features_from_answers({"who_directs": choice("boss"), "formality": choice("formal"),
                               "nonsense": choice("x")})
    assert f.power.value == "unknown" and f.power.p == 0
    assert f.formality.value == "formal"


def test_noul_answers_become_probabilities() -> None:
    f = features_from_answers({"family": noul(0.8), "joking": noul(0.3)})
    assert f.family == pytest.approx(0.8) and f.joking == pytest.approx(0.3)
    assert f.affection == 0.0  # missing answers count as NO


# ---------- deterministic mapping ----------
@pytest.mark.parametrize("over,kind", [
    ({"family": noul(0.9), "familiarity": choice("close")}, "family"),
    ({"affection": noul(0.9), "familiarity": choice("close")}, "partner"),
    ({"service": choice("they_serve")}, "service"),
    ({"service": choice("i_serve"), "topics": choice("work")}, "client"),
    ({"teaching": choice("they_teach")}, "teacher"),
    ({"teaching": choice("i_teach")}, "student"),
    ({"topics": choice("work"), "who_directs": choice("they_lead")}, "boss"),
    ({"topics": choice("work"), "permission": choice("i_ask")}, "boss"),
    ({"topics": choice("work"), "who_directs": choice("i_lead")}, "report"),
    ({"topics": choice("work"), "same_org": noul(0.9)}, "coworker"),
    ({"familiarity": choice("close"), "joking": noul(0.8)}, "friend"),
    ({"familiarity": choice("acquainted")}, "acquaintance"),
    ({"familiarity": choice("strangers"), "topics": choice("other")}, "stranger"),
])
def test_mapping(over: dict[str, Any], kind: str) -> None:
    rel = map_features(features_from_answers(answers(**over)), words=400, source="decisions")
    assert rel.kind == kind
    assert 0 < rel.confidence <= 0.95
    assert 1 <= len(rel.evidence) <= 3


def test_low_confidence_signals_give_unknown() -> None:
    f = features_from_answers(answers(familiarity=choice("acquainted", 0.3), topics=choice("mixed", 0.3)))
    rel = map_features(f, words=400, source="decisions")
    assert rel.kind == "unknown"


def test_power_formality_and_warmth_are_reported() -> None:
    f = features_from_answers(answers(topics=choice("work"), who_directs=choice("they_lead"),
                                      formality=choice("formal"), familiarity=choice("acquainted")))
    rel = map_features(f, words=400, source="decisions")
    assert (rel.power, rel.formality) == ("they_lead", "formal")
    close = map_features(features_from_answers(answers(familiarity=choice("close"), joking=noul(0.9))),
                         words=400, source="decisions")
    assert close.warmth > rel.warmth


def test_evidence_is_short_and_never_quotes() -> None:
    f = features_from_answers(answers(familiarity=choice("close"), joking=noul(0.9),
                                      formality=choice("casual")))
    rel = map_features(f, words=400, source="decisions")
    assert all(len(e) <= 60 for e in rel.evidence)


def test_less_speech_means_less_confidence() -> None:
    f = features_from_answers(answers(topics=choice("work"), who_directs=choice("they_lead")))
    assert map_features(f, words=90, source="decisions").confidence < \
        map_features(f, words=600, source="decisions").confidence


# ---------- sample + thresholds ----------
def test_format_labels_speakers_and_strips_newlines() -> None:
    s = sample((("other", "hello\nthere"), ("me", "hi")))
    text = format_sample(s)
    assert "OTHER: hello there" in text and "ME: hi" in text


def test_format_is_capped() -> None:
    long = tuple(("me" if i % 2 else "other", "word " * 200) for i in range(200))
    assert len(format_sample(sample(long))) <= MAX_INPUT_CHARS + 200


def test_thin_sample_reason() -> None:
    assert thin_reason(sample(ex.SHORT)) is not None
    assert thin_reason(sample(ex.BOSS)) is None
    one_sided = tuple(("me", "I talked about the project plan and the budget for a while today") for _ in range(10))
    assert thin_reason(sample(one_sided)) is not None


async def test_thin_sample_is_unknown_without_an_api_call() -> None:
    decide, calls = stub(answers(familiarity=choice("close")))
    rel = await infer(sample(ex.SHORT), decide=decide)
    assert rel.kind == "unknown" and rel.confidence == 0 and calls == []
    assert rel.evidence and "word" in rel.evidence[0]


# ---------- the Decisions path ----------
async def test_decisions_path() -> None:
    decide, calls = stub(answers(topics=choice("work"), who_directs=choice("they_lead"),
                                 permission=choice("i_ask")))
    rel = await infer(sample(ex.BOSS), decide=decide)
    assert isinstance(rel, Relationship)
    assert rel.kind == "boss" and rel.source == "decisions" and rel.power == "they_lead"
    assert len(calls) == 1 and calls[0]["questions"] is QUESTIONS
    assert "ME:" in calls[0]["text"] and "OTHER:" in calls[0]["text"]


async def test_injection_text_is_only_data() -> None:
    decide, calls = stub(answers(familiarity=choice("close"), joking=noul(0.9)))
    rel = await infer(sample(ex.INJECTION_FRIEND), decide=decide)
    assert rel.kind == "friend"
    assert calls[0]["questions"] is QUESTIONS  # the transcript never changes the questions


@pytest.mark.parametrize("error", [DecisionsUnavailable("no key"), RuntimeError("boom"), ValueError("bad")])
async def test_failure_falls_back_to_rules(error: Exception) -> None:
    decide, _ = stub(error)
    rel = await infer(sample(ex.BOSS), decide=decide)
    assert rel.source == "rules" and rel.confidence <= RULES_CAP


async def test_all_answers_invalid_falls_back_to_rules() -> None:
    decide, _ = stub({"who_directs": choice("boss")})
    rel = await infer(sample(ex.FRIEND), decide=decide)
    assert rel.source == "rules"


async def test_rules_only() -> None:
    decide, calls = stub(answers())
    rel = await infer(sample(ex.FRIEND), decide=decide, rules_only=True)
    assert rel.source == "rules" and calls == []


# ---------- rules ----------
@pytest.mark.parametrize("lines,kind", [
    (ex.BOSS, "boss"), (ex.REPORT, "report"), (ex.FRIEND, "friend"), (ex.PARENT, "family"),
    (ex.PARTNER, "partner"), (ex.SHOP, "service"), (ex.STRANGER, "stranger"),
])
def test_rules_on_clear_cases(lines: ex.Lines, kind: str) -> None:
    rel = map_features(rule_features(sample(lines)), words=400, source="rules")
    assert rel.kind == kind


def test_rules_injection_does_not_make_a_boss() -> None:
    rel = map_features(rule_features(sample(ex.INJECTION_FRIEND)), words=400, source="rules")
    assert rel.kind == "friend"


def test_rules_ambiguous_is_unknown_or_low() -> None:
    for lines in (ex.AMBIGUOUS_WEATHER, ex.AMBIGUOUS_MIXED):
        rel = map_features(rule_features(sample(lines)), words=400, source="rules")
        assert rel.kind == "unknown" or rel.confidence < 0.4


def test_rules_cap_confidence() -> None:
    rel = map_features(rule_features(sample(ex.BOSS)), words=2000, source="rules")
    assert rel.confidence <= RULES_CAP


def test_features_default_is_unknown() -> None:
    f = Features()
    assert f.power == Signal("unknown", 0.0)
    assert map_features(f, words=400, source="rules").kind == "unknown"
