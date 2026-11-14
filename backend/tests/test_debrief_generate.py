"""generate.py and prompt.py: retry, fallback and prompt content. No network."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

from backend.contracts import Debrief, Metrics, SessionSummary, TimelinePoint
from backend.debrief import generate as gen
from backend.debrief.prompt import build_prompt
from backend.debrief.rules import check_draft
from backend.debrief.wire import BetterVersionDraft, BookmarkNote, DebriefDraft
from backend.llm import LLMUnavailable
from backend.state import SessionState

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "try_debrief.py"
T04 = (
    "Yeah, so, um, I think maybe I'd split profit into revenue and costs. On revenue, you know, it could "
    "possibly be fewer customers or, um, sort of smaller tickets per visit, I'm not totally sure but I'd "
    "want traffic by store. Then on costs, like, bean prices have kind of gone up a lot, and labor too, and "
    "basically margins are getting squeezed. Um, I think maybe there's also, you know, competition from the "
    "big chains opening nearby, which could sort of pull people away. And, like, I'd check whether the newer "
    "stores are, um, kind of underperforming. I think maybe I'd start with revenue, but I'm not totally sure, "
    "it could possibly be costs, like, basically both."
)


def _load_script() -> ModuleType:
    spec = importlib.util.spec_from_file_location("try_debrief", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


DEMO = _load_script()


@pytest.fixture
def demo() -> tuple[SessionState, Metrics, list[TimelinePoint]]:
    return DEMO.build_demo()


def good_draft() -> DebriefDraft:
    return DebriefDraft(
        headline_fact=('You averaged 7.5 fillers a minute, and your framework answer ended '
                       '"it could possibly be costs, like, basically both."'),
        strength='When asked to pick one branch, you said "Revenue first" and asked how the client defines success.',
        one_fix='In your framework answer you named revenue, then took it back with "I\'m not totally sure".',
        if_then='When you hear yourself say "I think maybe", stop and state your choice in one sentence.',
        best_moment_quote="Revenue first.",
        vs_last_time="Fillers fell from 9.1 to 7.5 per minute.",
        notes=["A coffee chain's profits fell twenty percent.", "You chose revenue first.",
               "You promised the deck tonight."],
        bookmarks=[BookmarkNote(index=0, what_happened="You bookmarked your framework answer."),
                   BookmarkNote(index=1, what_happened="You promised the deck.", follow_up="Send the deck tonight.")],
        better_version=BetterVersionDraft(original=T04, rewritten="I'd split profit into revenue and costs, "
                                          "and start with revenue. Can I see traffic by store?"),
    )


def bad_draft() -> DebriefDraft:
    return good_draft().model_copy(update={"if_then": "Try to be more decisive next time."})


class FakeLLM:
    """Async stand-in for generate_structured: returns or raises the queued items in order."""

    def __init__(self, *outputs: Any) -> None:
        self.outputs = list(outputs)
        self.prompts: list[str] = []

    async def __call__(self, prompt: str, schema: type, **kwargs: Any) -> Any:
        self.prompts.append(prompt)
        item = self.outputs.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item


def _patch(monkeypatch: pytest.MonkeyPatch, fake: FakeLLM) -> FakeLLM:
    monkeypatch.setattr(gen, "generate_structured", fake)
    return fake


def test_good_draft_passes_rules(demo: tuple) -> None:
    session, metrics, _ = demo
    assert check_draft(good_draft(), session, metrics) == []


async def test_good_first_draft_uses_llm(monkeypatch: pytest.MonkeyPatch, demo: tuple) -> None:
    session, metrics, timeline = demo
    fake = _patch(monkeypatch, FakeLLM(good_draft()))
    debrief, info = await gen.generate_with_info(session, metrics, timeline, None)
    assert info["source"] == "llm" and info["attempts"] == 1 and len(fake.prompts) == 1
    assert debrief.numbers.fillers_per_min == metrics.fillers_per_min
    assert debrief.numbers.talk_ratio == metrics.talk_ratio and debrief.numbers.wpm == metrics.wpm
    assert debrief.vs_last_time is None  # forced, the draft had one
    assert debrief.headline_fact == good_draft().headline_fact
    assert debrief.timeline == timeline


async def test_bad_then_good_retries_with_reasons(monkeypatch: pytest.MonkeyPatch, demo: tuple) -> None:
    session, metrics, timeline = demo
    reasons = check_draft(bad_draft(), session, metrics)
    assert reasons, "check_draft should reject an if_then that starts with 'Try'"
    fake = _patch(monkeypatch, FakeLLM(bad_draft(), good_draft()))
    debrief, info = await gen.generate_with_info(session, metrics, timeline, None)
    assert info["source"] == "llm_retry" and info["attempts"] == 2 and len(fake.prompts) == 2
    assert "previous answer was rejected" not in fake.prompts[0]
    assert "Your previous answer was rejected for:" in fake.prompts[1]
    assert all(r in fake.prompts[1] for r in reasons)
    assert debrief.if_then.startswith("When")


async def test_bad_twice_falls_back(monkeypatch: pytest.MonkeyPatch, demo: tuple) -> None:
    session, metrics, timeline = demo
    fake = _patch(monkeypatch, FakeLLM(bad_draft(), bad_draft()))
    debrief, info = await gen.generate_with_info(session, metrics, timeline, None)
    assert info["source"] == "fallback" and len(fake.prompts) == 2 and info["reasons"]
    assert debrief.if_then != bad_draft().if_then
    assert debrief.numbers.questions == metrics.questions


@pytest.mark.parametrize("error", [LLMUnavailable("no key"), RuntimeError("boom")])
async def test_errors_fall_back_without_raising(monkeypatch: pytest.MonkeyPatch, demo: tuple,
                                                error: BaseException) -> None:
    session, metrics, timeline = demo
    _patch(monkeypatch, FakeLLM(error))
    debrief = await gen.generate_debrief(session, metrics, timeline, None)
    assert isinstance(debrief, Debrief)
    assert debrief.if_then.split()[0] in {"When", "If"}


async def test_broken_fallback_still_returns(monkeypatch: pytest.MonkeyPatch, demo: tuple) -> None:
    session, metrics, timeline = demo
    _patch(monkeypatch, FakeLLM(RuntimeError("boom")))

    def broken(*args: Any) -> Debrief:
        raise ValueError("fallback broke")

    monkeypatch.setattr(gen, "fallback_debrief", broken)
    debrief = await gen.generate_debrief(session, metrics, timeline, None)
    assert debrief.numbers.talk_ratio == metrics.talk_ratio


def test_prompt_contents_without_last(demo: tuple) -> None:
    session, metrics, _ = demo
    prompt = build_prompt(session, metrics, None)
    assert "hedging" in prompt and session.coach.goal in prompt
    assert all(f"{t.turn_id} [" in prompt for t in session.turns)
    assert "t04: hedging p=0.93" in prompt
    assert "no past session" in prompt.lower()
    assert "Send the deck tonight" in prompt
    assert "I'll send you the deck tonight" in prompt  # bookmark snippet
    assert "7.5" in prompt and "68%" in prompt
    assert "previous answer was rejected" not in prompt


def test_prompt_contents_with_last_and_reasons(demo: tuple) -> None:
    session, metrics, _ = demo
    last: SessionSummary = DEMO.demo_last()
    prompt = build_prompt(session, metrics, last, ["if_then must start with When or If"])
    assert "9.1" in prompt and "72%" in prompt and last.headline_fact in prompt
    assert "no past session" not in prompt.lower()
    assert prompt.rstrip().endswith("still follows all the rules.")
    assert "if_then must start with When or If" in prompt


def test_prompt_length_bound(demo: tuple) -> None:
    session, metrics, _ = demo
    assert len(build_prompt(session, metrics, DEMO.demo_last())) < 8000
