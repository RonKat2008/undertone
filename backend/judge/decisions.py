"""Gemini Decisions API judge: one call per wearer turn, hard deadline, wire-contract mapping.

Decisions answer shapes (google-genai 3.3.0, verified live):
    noul   -> .noul (P(true)), .confidence
    choice -> .choice, .probabilities, .confidence
    score  -> .score (0-BASED expected level), .legend, .probabilities, .confidence
On the wire, ScoreAnswer.score is 1-BASED (score + 1) with max = len(criteria).
"""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Mapping
from typing import Any

from backend import config
from backend.contracts import (
    ChoiceAnswer, ChoiceQuestion, CoachQuestion, CoachSpec, JudgeAnswer, NoulAnswer, NoulQuestion,
    ScoreAnswer, ScoreQuestion,
)
from backend.judge.core_questions import CORE_QUESTIONS

log = logging.getLogger("undertone.judge")

MODEL = "gemini-decision-1"
DEADLINE_S = 0.8
_P_MIN, _P_MAX = 0.01, 0.99
_MIN_CHOICE_OPTIONS = 2
_WARM_UP_QUESTION: dict[str, CoachQuestion] = {
    "warm": NoulQuestion(instructions="Is this a greeting?"),
}

_client: Any | None = None


class DecisionsUnavailable(RuntimeError):
    """No key, timeout, API error, or malformed/empty response."""


# ---------- questions ----------
def merge_questions(coach: CoachSpec) -> dict[str, CoachQuestion]:
    """CORE_QUESTIONS then coach.questions (coach wins). Drops choice questions with <2 options."""
    merged: dict[str, CoachQuestion] = {**CORE_QUESTIONS, **coach.questions}
    valid: dict[str, CoachQuestion] = {}
    for qid, q in merged.items():
        if isinstance(q, ChoiceQuestion) and len(q.criteria) < _MIN_CHOICE_OPTIONS:
            log.warning("skipping choice question %r on coach %s: needs >= 2 options", qid, coach.id)
            continue
        valid[qid] = q
    return valid


def questions_payload(questions: dict[str, CoachQuestion]) -> dict[str, dict[str, Any]]:
    return {qid: q.model_dump() for qid, q in questions.items()}


# ---------- answers ----------
def _get(obj: Any, name: str) -> Any:
    if isinstance(obj, Mapping):
        return obj.get(name)
    return getattr(obj, name, None)


def _num(value: Any) -> float:
    if value is None or isinstance(value, bool):
        raise ValueError("missing number")
    return float(value)


def _map_one(answer: Any, question: CoachQuestion) -> JudgeAnswer:
    kind = _get(answer, "type")
    confidence = _num(_get(answer, "confidence"))
    if isinstance(question, NoulQuestion) and kind == "noul":
        p = min(_P_MAX, max(_P_MIN, _num(_get(answer, "noul"))))
        return NoulAnswer(p=p, confidence=confidence)
    if isinstance(question, ChoiceQuestion) and kind == "choice":
        choice = _get(answer, "choice")
        if not isinstance(choice, str):
            raise ValueError("missing choice")
        probs = {str(k): float(v) for k, v in dict(_get(answer, "probabilities") or {}).items()}
        return ChoiceAnswer(choice=choice, probabilities=probs, confidence=confidence)
    if isinstance(question, ScoreQuestion) and kind == "score":
        score = round(_num(_get(answer, "score")) + 1, 3)
        return ScoreAnswer(score=score, max=len(question.criteria), confidence=confidence)
    raise ValueError(f"type {kind!r} does not match question type {question.type!r}")


def map_answers(raw: Mapping[str, Any], questions: dict[str, CoachQuestion]) -> dict[str, JudgeAnswer]:
    """Map Decisions answers (SDK objects or dicts) onto contract JudgeAnswers. Skips bad ones."""
    out: dict[str, JudgeAnswer] = {}
    for qid, answer in raw.items():
        question = questions.get(qid)
        if question is None:
            log.warning("decisions returned unknown question id %r; skipped", qid)
            continue
        try:
            out[qid] = _map_one(answer, question)
        except (TypeError, ValueError) as exc:
            log.warning("decisions answer %r skipped: %s", qid, exc)
    return out


# ---------- client ----------
def get_client() -> Any | None:
    """The shared genai.Client (created once, lazily). None if no Gemini key is configured."""
    global _client
    if _client is not None:
        return _client
    settings = config.settings
    if not settings.has_gemini:
        return None
    from google import genai

    _client = genai.Client(api_key=settings.gemini_api_key, http_options={"api_version": "v1beta"})
    return _client


def reset_client() -> None:
    global _client
    _client = None


# ---------- calls ----------
async def decide(input_text: str, questions: dict[str, CoachQuestion], *, timeout_s: float = DEADLINE_S,
                 client: Any | None = None) -> dict[str, JudgeAnswer]:
    """One Decisions call under a hard deadline. Raises DecisionsUnavailable on any failure."""
    client = client if client is not None else get_client()
    if client is None:
        raise DecisionsUnavailable("no Gemini client (missing key)")
    try:
        call = client.aio.decisions.create(
            model=MODEL, input=input_text, questions=questions_payload(questions), timeout=timeout_s,
        )
        response = await asyncio.wait_for(call, timeout=timeout_s)
    except TimeoutError as exc:
        raise DecisionsUnavailable(f"timed out after {timeout_s * 1000:.0f} ms") from exc
    except Exception as exc:  # noqa: BLE001 - every API failure means "fall back"
        raise DecisionsUnavailable(f"{type(exc).__name__}: {str(exc)[:200]}") from exc
    raw = _get(response, "answers")
    if not isinstance(raw, Mapping) or not raw:
        raise DecisionsUnavailable("empty or malformed answers")
    answers = map_answers(raw, questions)
    if not answers:
        raise DecisionsUnavailable("no usable answers")
    return answers


async def warm_up(timeout_s: float = 3.0) -> bool:
    """Open the TLS connection on the shared client with a tiny call. Never raises."""
    settings = config.settings
    if settings.use_rule_judge_only or not settings.has_gemini:
        return False
    try:
        await decide("WEARER: hello there!", _WARM_UP_QUESTION, timeout_s=timeout_s)
    except Exception as exc:  # noqa: BLE001
        log.warning("judge warm-up failed: %s", exc)
        return False
    return True
