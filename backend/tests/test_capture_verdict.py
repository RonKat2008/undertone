"""Keep classifier: Decisions answer mapping, rule fallback, stored effects (backend/capture)."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest

from backend.capture import store
from backend.capture.verdict import (
    KEEP_QUESTIONS, MAX_INPUT_CHARS, classify, format_transcript, rule_verdict, verdict_from_answers,
)
from backend.contracts import ChoiceAnswer, ChoiceQuestion, NoulAnswer, NoulQuestion, TurnFinalEvent
from backend.db import DB
from backend.judge.decisions import DecisionsUnavailable


def turn(i: int, speaker: str, text: str) -> TurnFinalEvent:
    return TurnFinalEvent(turn_id=f"t{i}", speaker=speaker, text=text, start=float(i * 3),  # type: ignore[arg-type]
                          end=float(i * 3 + 2), wpm=150)


LONG = [turn(i, "me" if i % 2 else "other", "we should plan the launch for next week with the whole team")
        for i in range(6)]
SHORT = [turn(0, "me", "hi"), turn(1, "other", "hey there")]


def answers(real: float = 0.9, worth: str = "keep", sensitive: float = 0.05) -> dict[str, Any]:
    return {"real_conversation": NoulAnswer(p=real, confidence=0.9),
            "worth_keeping": ChoiceAnswer(choice=worth, probabilities={worth: 0.9}, confidence=0.9),
            "sensitive": NoulAnswer(p=sensitive, confidence=0.9)}


def stub(result: dict[str, Any] | Exception):
    calls: list[dict[str, Any]] = []

    async def decide(text: str, questions: dict, *, timeout_s: float) -> dict[str, Any]:
        calls.append({"text": text, "questions": questions, "timeout_s": timeout_s})
        if isinstance(result, Exception):
            raise result
        return result

    return decide, calls


# ---------- questions + input ----------
def test_questions_have_the_agreed_shapes() -> None:
    assert isinstance(KEEP_QUESTIONS["real_conversation"], NoulQuestion)
    assert isinstance(KEEP_QUESTIONS["sensitive"], NoulQuestion)
    worth = KEEP_QUESTIONS["worth_keeping"]
    assert isinstance(worth, ChoiceQuestion) and set(worth.criteria) == {"keep", "trivial", "noise"}
    for q in KEEP_QUESTIONS.values():
        assert "YES" in q.instructions or isinstance(q, ChoiceQuestion)


def test_transcript_labels_and_cap() -> None:
    text = format_transcript(SHORT)
    assert text == "ME: hi\nOTHER: hey there"
    many = [turn(i, "me", "word " * 50) for i in range(100)]
    capped = format_transcript(many)
    assert len(capped) <= MAX_INPUT_CHARS + 40 and capped.endswith("[... transcript cut ...]")


# ---------- mapping ----------
@pytest.mark.parametrize(("kw", "reason"), [
    ({}, "keep"),
    ({"worth": "trivial"}, "trivial"),
    ({"worth": "noise"}, "noise"),
    ({"real": 0.2}, "noise"),
    ({"sensitive": 0.8}, "sensitive"),
    ({"sensitive": 0.8, "worth": "noise"}, "sensitive"),
])
def test_mapping(kw: dict[str, Any], reason: str) -> None:
    v = verdict_from_answers(answers(**kw), 120.0)
    assert (v.reason, v.kept, v.source, v.latency_ms) == (reason, reason == "keep", "decisions", 120.0)


def test_mapping_needs_worth_keeping() -> None:
    with pytest.raises(ValueError):
        verdict_from_answers({"sensitive": NoulAnswer(p=0.1, confidence=0.9)})


# ---------- rules ----------
def test_rule_fallback_thresholds() -> None:
    assert rule_verdict(LONG).reason == "keep"
    assert rule_verdict(SHORT).reason == "trivial"
    four_short = [turn(i, "me", "ok then") for i in range(4)]
    assert rule_verdict(four_short).reason == "trivial"  # 4 turns but < 40 words
    assert rule_verdict(LONG).source == "rules"


# ---------- classify ----------
def test_classify_uses_decisions_with_generous_timeout() -> None:
    decide, calls = stub(answers(worth="trivial"))
    v = asyncio.run(classify(LONG, decide=decide))
    assert v.reason == "trivial" and v.source == "decisions" and v.latency_ms is not None
    assert calls[0]["timeout_s"] >= 10 and calls[0]["text"].startswith("OTHER:")
    assert set(calls[0]["questions"]) == set(KEEP_QUESTIONS)


@pytest.mark.parametrize("failure", [DecisionsUnavailable("timed out"), RuntimeError("boom")])
def test_classify_falls_back_to_rules(failure: Exception) -> None:
    decide, _ = stub(failure)
    assert asyncio.run(classify(LONG, decide=decide)).source == "rules"
    assert asyncio.run(classify(SHORT, decide=decide)).reason == "trivial"


def test_classify_bad_answers_fall_back() -> None:
    decide, _ = stub({"sensitive": NoulAnswer(p=0.1, confidence=0.9)})
    v = asyncio.run(classify(LONG, decide=decide))
    assert (v.reason, v.source) == ("keep", "rules")


def test_classify_without_key_is_rules() -> None:  # conftest: no Gemini key
    assert asyncio.run(classify(LONG)).source == "rules"


# ---------- stored effects ----------
@pytest.fixture
def db(tmp_path: Path):
    d = DB(tmp_path / "v.db")
    d.create_session("s-1", "default", "Default", "regular", "2026-11-14T10:00:00+00:00")
    for t in LONG:
        d.save_turn("s-1", t)
    yield d
    d.close()


def _recording(tmp_path: Path, db: DB) -> Path:
    path = tmp_path / "rec" / "s-1.wav"
    path.parent.mkdir(exist_ok=True)
    path.write_bytes(b"RIFF")
    db.set_recording("s-1", 0.5, 12.0)
    return path


@pytest.mark.parametrize(("reason", "audio_kept"), [("keep", True), ("trivial", True), ("noise", False),
                                                   ("sensitive", False)])
def test_verdict_effects_on_audio(tmp_path: Path, db: DB, reason: str, audio_kept: bool) -> None:
    path = _recording(tmp_path, db)
    decide, _ = stub(answers(worth=reason) if reason != "sensitive" else answers(sensitive=0.9))
    v = asyncio.run(store.classify_session(db, path.parent, "s-1", quiet=False, decide=decide))
    row = db.get_session("s-1")
    assert v is not None and row is not None
    assert (row["kept"], row["kept_reason"], row["kept_source"]) == (int(reason == "keep"), reason, "decisions")
    assert path.exists() is audio_kept
    assert (row["audio_s"] is not None) is audio_kept


def test_quiet_capture_is_trivial_without_a_call(tmp_path: Path, db: DB) -> None:
    decide, calls = stub(answers())
    v = asyncio.run(store.classify_session(db, tmp_path, "s-1", quiet=True, decide=decide))
    assert v is not None and (v.reason, v.source) == ("trivial", "rules") and calls == []


def test_recording_finishing_after_a_noise_verdict_is_deleted(tmp_path: Path, db: DB) -> None:
    from backend.capture.recorder import RecordingInfo

    db.set_verdict("s-1", False, "noise", "decisions")
    path = tmp_path / "s-1.wav"
    path.write_bytes(b"RIFF")
    store.store_recording(db, tmp_path, RecordingInfo("s-1", path, 3.0, 0.5))
    assert not path.exists() and db.get_session("s-1")["audio_s"] is None  # type: ignore[index]


def test_classify_session_never_raises(tmp_path: Path, db: DB) -> None:
    db.close()  # every write now fails
    assert asyncio.run(store.classify_session(db, tmp_path, "s-1", quiet=True)) is None
