"""Tests for the pure rule judge (backend/judge/rules.py)."""

from __future__ import annotations

import pytest

from backend.contracts import (
    ChoiceAnswer, ChoiceQuestion, CoachSpec, Drill, NoulAnswer, NoulQuestion, NudgePolicy,
    ScoreAnswer, ScoreQuestion, TurnContext, TurnFinalEvent,
)
from backend.judge.core_questions import CORE_QUESTION_IDS
from backend.judge.rules import rule_judge

WORDS_PER_S = 2.5


def make_ctx(
    prev_text: str | None,
    me_text: str,
    gap_s: float = 0.6,
    fillers: list[str] | None = None,
) -> TurnContext:
    """Prev turn 0-5 s; wearer starts gap_s after it ends (negative gap = overlap)."""
    prev = None
    if prev_text is not None:
        prev = TurnFinalEvent(turn_id="o1", speaker="other", text=prev_text, start=0.0, end=5.0, wpm=150)
    start = 5.0 + gap_s
    dur = max(0.5, len(me_text.split()) / WORDS_PER_S)
    turn = TurnFinalEvent(
        turn_id="m1", speaker="me", text=me_text, start=start, end=start + dur, wpm=150,
        fillers=fillers or [],
    )
    return TurnContext(turn=turn, prev_other_turn=prev)


def make_coach(questions: dict | None = None) -> CoachSpec:
    return CoachSpec(
        id="c", name="Test", goal="g", kind="custom", confidence_threshold=0.5,
        questions=questions or {}, nudge_policy=NudgePolicy(focus_rule_id="interrupt"),
        drill=Drill(partner_persona="friend"),
    )


def judge(prev: str | None, me: str, gap_s: float = 0.6, **kw: object) -> dict:
    return rule_judge(make_ctx(prev, me, gap_s, **kw), make_coach())  # type: ignore[arg-type]


def p(res: dict, key: str) -> float:
    ans = res[key]
    assert isinstance(ans, NoulAnswer)
    return ans.p


def choice(res: dict, key: str) -> str:
    ans = res[key]
    assert isinstance(ans, ChoiceAnswer)
    return ans.choice


# ---------- shape ----------
def test_answers_all_core_ids() -> None:
    res = judge("How are you?", "Good, thanks.")
    assert set(CORE_QUESTION_IDS) <= set(res)


@pytest.mark.parametrize(
    ("prev", "me"),
    [
        (None, ""),
        ("", "   "),
        ("Hello—", "..."),
        ("What?", "Um, uh, like, um."),
        ("So", "I, I, I, sorry, let me start over, sorry."),
    ],
)
def test_never_raises_and_ranges(prev: str | None, me: str) -> None:
    res = judge(prev, me)
    for ans in res.values():
        if isinstance(ans, NoulAnswer):
            assert 0.01 <= ans.p <= 0.99
            assert ans.confidence == pytest.approx(max(ans.p, 1 - ans.p))
        elif isinstance(ans, ChoiceAnswer):
            assert sum(ans.probabilities.values()) == pytest.approx(1.0, abs=0.01)
            assert ans.confidence == pytest.approx(ans.probabilities[ans.choice])
        else:
            assert isinstance(ans, ScoreAnswer)
            assert 1 <= ans.score <= 5 and ans.max == 5


def test_choice_option_sets() -> None:
    res = judge("Hi.", "Hello there.")
    assert set(res["question_type"].probabilities) == {"open", "closed", "leading", "none"}
    assert set(res["tone"].probabilities) == {"confident", "nervous", "defensive", "warm", "flat"}


# ---------- interrupted ----------
def test_dash_cutoff_is_interrupt() -> None:
    assert p(judge("The main reason we picked that design was—", "Sure, but cost matters more."), "interrupted") >= 0.8


def test_trailing_ellipsis_cutoff_is_interrupt() -> None:
    assert p(judge("I was going to mention that the roof...", "The roof is fine."), "interrupted") >= 0.8


def test_overlap_timing_is_interrupt() -> None:
    assert p(judge("We could ship it next week.", "No, that's way too early.", gap_s=-0.8), "interrupted") >= 0.8


def test_near_zero_gap_is_moderate() -> None:
    val = p(judge("We could ship it next week.", "That works for me.", gap_s=0.05), "interrupted")
    assert 0.35 <= val <= 0.65


def test_cutoff_plus_timing_is_strongest() -> None:
    both = p(judge("And then the client said—", "Wait, which client?", gap_s=-0.5), "interrupted")
    alone = p(judge("And then the client said—", "Wait, which client?"), "interrupted")
    assert both >= alone >= 0.8


def test_no_prev_turn_is_low() -> None:
    assert p(judge(None, "Morning everyone, let's get started."), "interrupted") <= 0.05


def test_leading_ellipsis_is_not_cutoff() -> None:
    assert p(judge("...so that's where we landed on pricing.", "Got it, thanks."), "interrupted") < 0.2


def test_backchannel_overlap_is_not_interrupt() -> None:
    assert p(judge("We spent the whole weekend repainting the kitchen.", "Mm-hm.", gap_s=-0.5), "interrupted") < 0.5


def test_clean_handoff_is_not_interrupt() -> None:
    assert p(judge("That's all from me.", "Thanks, I have one follow-up."), "interrupted") < 0.2


# ---------- asked_question / question_type ----------
def test_open_question() -> None:
    res = judge("I started a new job.", "How are you finding the people there?")
    assert p(res, "asked_question") > 0.7 and choice(res, "question_type") == "open"


def test_closed_question() -> None:
    res = judge("I started a new job.", "Is it a long commute?")
    assert p(res, "asked_question") > 0.7 and choice(res, "question_type") == "closed"


def test_either_or_is_closed() -> None:
    res = judge("We need a venue.", "Should we book the hall, or just use the office?")
    assert choice(res, "question_type") == "closed"


def test_rhetorical_question_not_asked() -> None:
    res = judge("The release slipped again.", "Who ever ships on schedule? No one. We'll adjust.")
    assert p(res, "asked_question") < 0.5 and choice(res, "question_type") == "none"


def test_uptalk_hedge_not_asked() -> None:
    res = judge("Is the plan any good?", "I guess it could maybe sort of work?")
    assert p(res, "asked_question") < 0.5 and choice(res, "question_type") == "none"


def test_tag_question_is_leading() -> None:
    res = judge("I'm weighing two offers.", "You'll pick the bigger one, right?")
    assert p(res, "asked_question") > 0.5 and choice(res, "question_type") == "leading"


def test_negative_aux_question_is_leading() -> None:
    res = judge("We need a name.", "Isn't the short name clearly better?")
    assert choice(res, "question_type") == "leading"


def test_leading_beats_open_when_both() -> None:
    res = judge("Rent is due.", "What do you want to do? We should just pay it now, shouldn't we?")
    assert choice(res, "question_type") == "leading"


def test_interrogative_without_question_mark_is_moderate() -> None:
    val = p(judge("I moved last month.", "do you like the new neighborhood"), "asked_question")
    assert 0.5 <= val <= 0.8


def test_statement_is_not_question() -> None:
    res = judge("How was it?", "It went well, we closed three deals.")
    assert p(res, "asked_question") < 0.2 and choice(res, "question_type") == "none"


# ---------- answered_the_question ----------
def test_answered_yes_when_nothing_asked() -> None:
    assert p(judge("I painted the fence today.", "Nice, what colour did you pick?"), "answered_the_question") > 0.6


def test_direct_number_answer() -> None:
    assert p(judge("How many people came?", "About sixty, maybe a few more."), "answered_the_question") > 0.6


def test_request_answered_with_ill() -> None:
    assert p(judge("Can you share the notes?", "Sure, I'll share them after this call."), "answered_the_question") > 0.6


def test_deflection_not_answered() -> None:
    res = judge("What's your budget for this?", "Good question. Before I answer, I'd love to hear more about your roadmap.")
    assert p(res, "answered_the_question") < 0.5


def test_restart_not_answered() -> None:
    res = judge("Tell me about your background.", "So I, I worked at, sorry, let me start over.")
    assert p(res, "answered_the_question") < 0.5


# ---------- hedging ----------
def test_no_hedge_direct() -> None:
    assert p(judge("Which option?", "Option B. It costs less and ships faster."), "hedging") < 0.2


def test_like_as_verb_is_not_hedge() -> None:
    assert p(judge("Hobbies?", "I like climbing and I like reading."), "hedging") < 0.2


def test_fillers_are_not_hedges() -> None:
    assert p(judge("When?", "Um, uh, Friday."), "hedging") < 0.2


def test_single_mild_hedge() -> None:
    val = p(judge("Will it rain?", "It might rain later."), "hedging")
    assert 0.2 <= val < 0.5


def test_stacked_hedges() -> None:
    assert p(judge("Is it ready?", "I'm not sure, I think maybe it's kind of close."), "hedging") >= 0.85


# ---------- rambling ----------
def test_short_turn_not_rambling() -> None:
    assert p(judge("Ready?", "Yes, let's go."), "rambling") < 0.1


def test_long_wandering_turn_is_rambling() -> None:
    me = (
        "So, um, the thing is, we had the, uh, the meeting, and then, you know, Dave was there, "
        "and he was saying, like, the vendor thing, which honestly is a whole other story, and "
        "anyway that reminds me of the time we went to that conference in Denver, the hotel was, "
        "um, really nice actually, and the food, and, so, yeah, anyway, I think we're kind of "
        "getting there, sort of, with the, the vendor, mostly, I mean, more or less, you know."
    )
    assert p(judge("Where are we on the vendor?", me), "rambling") > 0.7


def test_long_structured_turn_not_rambling() -> None:
    me = (
        "Two things. First, revenue grew twelve percent to four million, driven by the enterprise "
        "tier. Second, churn fell from five to three percent after we shipped onboarding. Next "
        "quarter we will focus on the mid-market segment and hire two account managers."
    )
    assert p(judge("How was the quarter?", me), "rambling") < 0.5


# ---------- acknowledged ----------
def test_acknowledgement_detected() -> None:
    assert p(judge("My flight got cancelled.", "Oh no, that sounds awful. Did they rebook you?"), "acknowledged") > 0.7


def test_fair_point_ack() -> None:
    assert p(judge("This seems expensive.", "That's a fair point. Here's how we'd cut it."), "acknowledged") > 0.7


def test_backchannel_plus_followup_ack() -> None:
    assert p(judge("We finished the audit.", "Mm-hm, right. What did it turn up?"), "acknowledged") > 0.5


def test_plain_okay_not_ack() -> None:
    assert p(judge("We finished the audit.", "Okay."), "acknowledged") < 0.3


def test_no_prev_ack_low() -> None:
    assert p(judge(None, "Hi, let's begin with the agenda."), "acknowledged") < 0.3


# ---------- tone ----------
def test_tone_nervous() -> None:
    res = judge("Tell me about the project.", "Um, so, sorry, I, I guess it was, uh, maybe kind of a mess? Sorry.")
    assert choice(res, "tone") == "nervous"


def test_tone_defensive() -> None:
    res = judge("The report had errors.", "That's not my fault. I did exactly what the spec said.")
    assert choice(res, "tone") == "defensive"


def test_tone_warm() -> None:
    res = judge("I ran my first marathon!", "Congrats, that's amazing! How do your legs feel?")
    assert choice(res, "tone") == "warm"


def test_tone_flat() -> None:
    assert choice(judge("We're getting a puppy!", "Okay. Sure."), "tone") == "flat"


def test_tone_confident() -> None:
    res = judge("What's the plan?", "We launch on the fifth with three partners and a two-week beta.")
    assert choice(res, "tone") == "confident"


# ---------- clarity ----------
def test_clarity_concise_is_five() -> None:
    res = judge("How long will it take?", "Two weeks. One for the backend and one for testing.")
    assert res["clarity"].score >= 4.5 and res["clarity"].max == 5


def test_clarity_hedged_is_low() -> None:
    res = judge("Thoughts?", "I mean, I guess maybe it could sort of work, I'm not sure, possibly?")
    assert res["clarity"].score <= 2.5


def test_clarity_restart_is_low() -> None:
    res = judge("Introduce yourself.", "So I, I, sorry, I am, um, I, sorry, let me start over.")
    assert res["clarity"].score <= 2.5


def test_clarity_fillers_slight_drop() -> None:
    res = judge("When works?", "Um, uh, Monday at ten works.")
    assert 3.0 <= res["clarity"].score <= 4.5


# ---------- commitment_made ----------
@pytest.mark.parametrize(
    "me",
    [
        "I'll send over the contract this afternoon.",
        "I will call the landlord tomorrow.",
        "I'm going to email Marcus before Friday.",
        "Got it, I'll fix the bug by end of day.",
    ],
)
def test_commitment_yes(me: str) -> None:
    assert p(judge("Can you handle it?", me), "commitment_made") > 0.8


@pytest.mark.parametrize(
    "me",
    [
        "We should grab lunch sometime.",
        "I'll try to send it when I can.",
        "I might call them at some point.",
        "Maybe I'll look into it next week if I get a chance.",
        "I sent it yesterday.",
    ],
)
def test_commitment_no(me: str) -> None:
    assert p(judge("Can you handle it?", me), "commitment_made") < 0.2


# ---------- coach-specific neutral answers ----------
def test_coach_specific_neutral_answers() -> None:
    coach = make_coach({
        "mentioned_price": NoulQuestion(instructions="Did they mention price?"),
        "style": ChoiceQuestion(instructions="Style?", criteria={"a": "A", "b": "B", "c": "C", "d": "D"}),
        "empathy": ScoreQuestion(instructions="Empathy?", criteria=["1", "2", "3", "4", "5"]),
        "hedging": NoulQuestion(instructions="Redefined core id."),
    })
    res = rule_judge(make_ctx("Hi.", "I'm not sure, I guess maybe."), coach)
    noul = res["mentioned_price"]
    assert isinstance(noul, NoulAnswer) and noul.p == 0.5 and noul.confidence == 0.5
    ch = res["style"]
    assert isinstance(ch, ChoiceAnswer) and ch.choice == "a"
    assert all(v == pytest.approx(0.25) for v in ch.probabilities.values()) and ch.confidence == pytest.approx(0.25)
    sc = res["empathy"]
    assert isinstance(sc, ScoreAnswer) and sc.score == 3 and sc.max == 5 and sc.confidence == 0.2
    assert p(res, "hedging") > 0.6  # core rule still answers a redefined core id
