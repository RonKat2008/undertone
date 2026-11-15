"""The built-in Demo Day coach: valid, listed, and its questions asked in order in a practice."""

from __future__ import annotations

from backend.studio import load_prebuilt, validate_coach
from backend.voice_practice.prompt import build_settings

DEMO_QUESTIONS = [
    "What did you build at this hackathon?",
    "Who is it for, and what problem does it solve?",
    "How does it work under the hood?",
    "What was the hardest part to build?",
    "What would you do next with it?",
]


def demo():  # type: ignore[no-untyped-def]
    return next(c for c in load_prebuilt() if c.id == "demo_day")


def test_demo_day_coach_is_valid_with_its_questions_in_order() -> None:
    coach = demo()
    assert coach.name == "Demo Day" and coach.kind == "prebuilt"
    assert validate_coach(coach) == []
    assert coach.drill.prompts == DEMO_QUESTIONS


def test_practice_opens_with_the_first_question_and_asks_the_rest_in_order() -> None:
    settings = build_settings(demo(), None, ())
    assert settings["agent"]["greeting"].endswith(DEMO_QUESTIONS[0])
    prompt = settings["agent"]["think"]["prompt"]
    positions = [prompt.index(q) for q in DEMO_QUESTIONS]
    assert positions == sorted(positions) and "in this order" in prompt
