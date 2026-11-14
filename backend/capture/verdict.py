"""Is a closed capture worth keeping? One Gemini Decisions call, with a rule fallback.

    v = await classify(turns)            # never raises
    v.kept, v.reason, v.source           # True only for 'keep'; 'decisions' | 'rules'

Reasons: keep (a real exchange with content), trivial (real but nothing to learn from),
noise (not a conversation), sensitive (private: not shown, audio not kept).
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

from backend.contracts import (
    ChoiceAnswer, ChoiceQuestion, CoachQuestion, JudgeAnswer, NoulAnswer, NoulQuestion, TurnFinalEvent,
)
from backend.judge import decisions

log = logging.getLogger("undertone.capture")

KeptReason = Literal["keep", "trivial", "noise", "sensitive"]
KeptSource = Literal["decisions", "rules", "user"]
KEPT_REASONS: frozenset[str] = frozenset(KeptReason.__args__)  # type: ignore[attr-defined]

CLASSIFY_TIMEOUT_S = 20.0  # not on the live path: generous
MAX_INPUT_CHARS = 6000
RULE_MIN_TURNS = 4
RULE_MIN_WORDS = 40
YES_P = 0.5

Decide = Callable[..., Awaitable[dict[str, JudgeAnswer]]]

KEEP_QUESTIONS: dict[str, CoachQuestion] = {
    "real_conversation": NoulQuestion(instructions=(
        "The input is an automatic transcript captured by a microphone worn by ME; OTHER is anyone else "
        "the microphone picked up. Answer YES if ME is actually taking part in a back-and-forth with at "
        "least one other person: ME says something, another person answers or reacts to it, and ME "
        "responds again (for example ME asks how the weekend went, OTHER describes a trip, ME asks a "
        "follow-up). Answer NO if the speech is background speech ME is not part of (a TV, radio, video "
        "or podcast playing; people talking nearby whose lines never respond to ME), if ME is talking to "
        "themselves, dictating, or talking to a phone assistant or other device, if it is a microphone "
        "test ('testing, one two three'), or if it is a fragment with no exchange (one or two lines, or "
        "only one side speaking).")),
    "worth_keeping": ChoiceQuestion(
        instructions=(
            "The input is an automatic transcript from a microphone worn by ME; OTHER is anyone else. "
            "Decide whether this capture is worth keeping in ME's conversation history."),
        criteria={
            "keep": ("A real exchange between ME and another person with some content: a topic, a "
                     "question and answer, a plan, news, a disagreement (for example discussing a project "
                     "deadline, catching up about family, planning dinner)."),
            "trivial": ("A real exchange but with nothing to learn from: only greetings, thanks, a "
                        "one-line logistics question, or a few words (for example 'Hi, how are you?' "
                        "'Good, you?' 'Fine, see you later')."),
            "noise": ("Not a conversation ME took part in: TV, video or radio audio, other people "
                      "talking nearby, ME talking to themselves or a device, a mic test, or garbled "
                      "fragments."),
        }),
    "sensitive": NoulQuestion(instructions=(
        "The input is an automatic transcript from a microphone worn by ME. Answer YES if the content is "
        "clearly private in a way ME would likely not want shown on a dashboard to other people: medical "
        "details (a diagnosis, symptoms, medication, therapy), financial account details (card or account "
        "numbers, passwords, PINs, exact balances or debts), intimate or sexual matters, or someone asking "
        "not to be recorded ('please don't record this', 'this is off the record'). Answer NO for ordinary "
        "work, school, family logistics, hobbies, opinions or mild personal news (for example a cold, a "
        "move, a new job), and for mentioning money or health only in passing.")),
}


@dataclass(frozen=True)
class Verdict:
    kept: bool
    reason: KeptReason
    source: KeptSource
    latency_ms: float | None = None


def make_verdict(reason: KeptReason, source: KeptSource, latency_ms: float | None = None) -> Verdict:
    return Verdict(kept=reason == "keep", reason=reason, source=source, latency_ms=latency_ms)


def format_transcript(turns: Sequence[TurnFinalEvent], max_chars: int = MAX_INPUT_CHARS) -> str:
    """ME/OTHER lines, oldest first, cut at `max_chars`."""
    lines = [f"{'ME' if t.speaker == 'me' else 'OTHER'}: {t.text.strip()}" for t in turns if t.text.strip()]
    text = "\n".join(lines) or "(no speech)"
    if len(text) <= max_chars:
        return text
    return text[:max_chars].rsplit("\n", 1)[0] + "\n[... transcript cut ...]"


def word_count(turns: Sequence[TurnFinalEvent]) -> int:
    return sum(len(t.text.split()) for t in turns)


def rule_verdict(turns: Sequence[TurnFinalEvent]) -> Verdict:
    """Fallback: keep with at least 4 turns and 40 words, else trivial."""
    enough = len(turns) >= RULE_MIN_TURNS and word_count(turns) >= RULE_MIN_WORDS
    return make_verdict("keep" if enough else "trivial", "rules")


def _p(answer: JudgeAnswer | None) -> float | None:
    return answer.p if isinstance(answer, NoulAnswer) else None


def verdict_from_answers(answers: Mapping[str, JudgeAnswer], latency_ms: float | None = None) -> Verdict:
    """Pure mapping. Raises ValueError when the deciding answer (worth_keeping) is missing."""
    worth = answers.get("worth_keeping")
    if not isinstance(worth, ChoiceAnswer) or worth.choice not in ("keep", "trivial", "noise"):
        raise ValueError("worth_keeping missing or unknown")
    sensitive, real = _p(answers.get("sensitive")), _p(answers.get("real_conversation"))
    if sensitive is not None and sensitive >= YES_P:
        return make_verdict("sensitive", "decisions", latency_ms)
    if worth.choice == "noise" or (real is not None and real < YES_P):
        return make_verdict("noise", "decisions", latency_ms)
    return make_verdict(worth.choice, "decisions", latency_ms)  # type: ignore[arg-type]


async def classify(turns: Sequence[TurnFinalEvent], decide: Decide | None = None,
                   timeout_s: float = CLASSIFY_TIMEOUT_S) -> Verdict:
    """One Decisions call; the rule verdict on any failure. Never raises."""
    if not turns:
        return make_verdict("trivial", "rules")
    call = decide if decide is not None else decisions.decide
    t0 = time.perf_counter()
    try:
        answers = await call(format_transcript(turns), KEEP_QUESTIONS, timeout_s=timeout_s)
        return verdict_from_answers(answers, round((time.perf_counter() - t0) * 1000, 1))
    except Exception as exc:  # noqa: BLE001 - DecisionsUnavailable, bad answers, anything else
        log.warning("keep classifier unavailable (%s); using rules", exc)
        return rule_verdict(turns)
