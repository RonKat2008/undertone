"""The Clear Across prebuilt coach (English as an additional language): spec, nudges, rule judge,
first-language hint and the route that serves it."""

from __future__ import annotations

import json
import re
from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

from backend import studio
from backend.contracts import (
    ChoiceAnswer, ChoiceQuestion, CoachSpec, Metrics, NoulAnswer, NoulQuestion, ScoreQuestion,
    TurnContext, TurnFinalEvent,
)
from backend.judge.rules import rule_judge
from backend.nudge import NudgeEngine
from backend.studio.clear_across import FIRST_LANGUAGE_FAMILIES, with_first_language
from backend.studio.personal import PREBUILT_NAMES
from backend.tests.test_nudge_support import PREBUILT, noul, set_demo, wall

COACH_ID = "clear_across"
BANNED = re.compile(r"\b(?:accent|native|error|mistake)", re.IGNORECASE)
LIVE_RULES = {"repair_request": "tap", "rushing": "slow_down", "check_in": "wrap_up"}


def _coach() -> CoachSpec:
    return CoachSpec.model_validate(json.loads((PREBUILT / f"{COACH_ID}.json").read_text()))


# ---------- spec ----------
def test_loads_and_validates() -> None:
    c = _coach()
    assert (c.id, c.name, c.kind) == (COACH_ID, "Clear Across", "prebuilt")
    assert studio.validate_coach(c) == []


def test_questions_have_the_intended_types() -> None:
    q = _coach().questions
    nouls = {"repair_request", "checked_understanding", "word_misfit", "time_or_who_unclear",
             "let_it_pass", "self_deprecation"}
    assert all(isinstance(q[k], NoulQuestion) for k in nouls)
    strategy = q["strategy_used"]
    assert isinstance(strategy, ChoiceQuestion)
    assert set(strategy.criteria) == {"paraphrase", "example", "asked_to_clarify", "none"}
    directness = q["directness_fit"]
    assert isinstance(directness, ScoreQuestion) and len(directness.criteria) == 5
    assert "well-pitched" in directness.criteria[2].lower()


def test_listed_wherever_prebuilt_coaches_are() -> None:
    assert COACH_ID in {c.id for c in studio.load_prebuilt()}
    assert COACH_ID in PREBUILT_NAMES


def test_only_three_rules_can_buzz_each_with_its_own_haptic() -> None:
    c = _coach()
    assert c.motion_rules == [] or all(r.enabled is False for r in c.motion_rules)
    live = {r.id: r.haptic for r in c.nudge_rules if r.enabled is not False}
    assert live == LIVE_RULES
    assert len(set(live.values())) == 3
    messages = {r.id: r.message for r in c.nudge_rules}
    assert messages["repair_request"] == "Say it another way"
    assert messages["rushing"] == "Breathe, then go on"
    assert messages["check_in"] == "Check they're with you"


def test_policy_is_sparing() -> None:
    p = _coach().nudge_policy
    assert (p.focus_rule_id, p.budget_per_session, p.min_gap_s, p.silent) == ("repair_request", 4, 180, False)


def test_no_banned_words_in_rubric_or_messages() -> None:
    c = _coach()
    texts = [c.debrief_rubric, *(r.message for r in [*c.nudge_rules, *c.motion_rules])]
    assert c.debrief_rubric.strip()
    for text in texts:
        assert not BANNED.search(text), text


def test_rubric_states_the_teaching_rules() -> None:
    rubric = _coach().debrief_rubric.lower()
    for needle in ("paraphras", "example", "clarification", "at most one fix", "own words",
                   "pronunciation", "articles", "own past sessions", "does that make sense",
                   "better_version", "second pass"):
        assert needle in rubric, needle


def test_drill_has_four_prompts() -> None:
    d = _coach().drill
    assert len(d.prompts) == 4 and "what do you mean" in d.partner_persona.lower()


# ---------- live nudges ----------
@pytest.fixture
def no_demo(monkeypatch: pytest.MonkeyPatch) -> None:
    set_demo(monkeypatch, False)


@pytest.fixture
def demo(monkeypatch: pytest.MonkeyPatch) -> None:
    set_demo(monkeypatch, True)


def _engine() -> NudgeEngine:
    c = _coach()
    return NudgeEngine(c, c.nudge_policy)


@pytest.mark.usefixtures("no_demo")
def test_repair_request_is_the_focus_buzz() -> None:
    e = _engine()
    n = e.evaluate(noul("repair_request", 0.9), Metrics(), None, 40.0, wall())
    assert n is not None and (n.rule_id, n.haptic, n.budget_left) == ("repair_request", "tap", 3)
    assert e.evaluate(noul("repair_request", 0.9), Metrics(), None, 100.0, wall()) is None  # min gap 180 s


@pytest.mark.usefixtures("demo")
def test_debrief_only_questions_never_buzz() -> None:
    for qid in ("word_misfit", "time_or_who_unclear", "let_it_pass", "self_deprecation",
                "checked_understanding"):
        assert _engine().evaluate(noul(qid, 0.99), Metrics(), None, 40.0, wall()) is None, qid


@pytest.mark.usefixtures("demo")
@pytest.mark.parametrize(("baseline", "wpm", "fires"), [
    (None, 175.0, True),    # no baseline yet: the absolute floor alone
    (None, 165.0, False),
    (120.0, 165.0, False),  # a slow speaker is never pushed below the 170 floor
    (120.0, 175.0, True),
    (150.0, 185.0, False),  # a quick speaker: own baseline x 1.3 = 195 wins over the floor
    (150.0, 200.0, True),
])
def test_pace_uses_own_baseline_with_a_floor(baseline: float | None, wpm: float, fires: bool) -> None:
    n = _engine().evaluate(None, Metrics(wpm=wpm, baseline_wpm=baseline), None, 40.0, wall())
    assert (n is not None and n.rule_id == "rushing") is fires


@pytest.mark.usefixtures("demo")
def test_long_stretch_asks_for_a_check_in() -> None:
    assert _engine().evaluate(None, Metrics(monologue_s=55), None, 40.0, wall()) is None
    n = _engine().evaluate(None, Metrics(monologue_s=61), None, 40.0, wall())
    assert n is not None and (n.rule_id, n.haptic) == ("check_in", "wrap_up")


# ---------- rule judge fallback ----------
def _ctx(prev: str | None, me: str, earlier_me: str | None = None) -> TurnContext:
    recent: list[TurnFinalEvent] = []
    if earlier_me is not None:
        recent.append(TurnFinalEvent(turn_id="m0", speaker="me", text=earlier_me, start=0.0, end=4.0, wpm=140))
    other = None
    if prev is not None:
        other = TurnFinalEvent(turn_id="o1", speaker="other", text=prev, start=4.5, end=6.0, wpm=150)
        recent.append(other)
    turn = TurnFinalEvent(turn_id="m1", speaker="me", text=me, start=6.5, end=10.0, wpm=140)
    return TurnContext(turn=turn, prev_other_turn=other, recent_turns=recent)


def _p(ctx: TurnContext, qid: str) -> float:
    ans = rule_judge(ctx, _coach())[qid]
    assert isinstance(ans, NoulAnswer)
    return ans.p


@pytest.mark.parametrize("prev", [
    "Sorry?", "What?", "Pardon?", "Sorry, could you say that again?", "Sorry, what do you mean?",
    "You mean the Berlin office?", "I didn't catch that.", "Can you repeat the last part?",
    "I'm not sure I follow.",
])
def test_repair_request_positive(prev: str) -> None:
    assert _p(_ctx(prev, "I mean the new office in Berlin."), "repair_request") >= 0.8


def test_repair_request_echo_of_the_wearers_words() -> None:
    ctx = _ctx("Assist the meeting?", "Yes, I will be there.", earlier_me="Tomorrow I will assist the meeting.")
    assert _p(ctx, "repair_request") >= 0.8


@pytest.mark.parametrize("prev", [
    None, "Sorry to hear that.", "What do you think about the plan?", "I mean, it was fine.",
    "Great, see you tomorrow.", "Sorry I'm late, traffic was awful.",
])
def test_repair_request_negative(prev: str | None) -> None:
    assert _p(_ctx(prev, "Okay, sounds good."), "repair_request") < 0.5


def test_short_question_that_is_not_an_echo_is_not_repair() -> None:
    ctx = _ctx("Lunch tomorrow?", "Sure.", earlier_me="The report is almost done.")
    assert _p(ctx, "repair_request") < 0.5


@pytest.mark.parametrize("me", [
    "So we ship in May. Does that make sense?", "Am I explaining this clearly?",
    "Are you with me so far?", "Is that clear?", "Am I making sense?",
])
def test_checked_understanding_positive(me: str) -> None:
    assert _p(_ctx("Go on.", me), "checked_understanding") >= 0.8


@pytest.mark.parametrize("me", [
    "It was, you know, a long week.", "That makes sense to me.", "We ship in May.",
    "Do you know where the meeting is?",
])
def test_checked_understanding_negative(me: str) -> None:
    assert _p(_ctx("Go on.", me), "checked_understanding") < 0.5


@pytest.mark.parametrize("me", [
    "Sorry for my English.", "Sorry, my English is not so good.", "Excuse my English, I try my best.",
    "My English is terrible, but the plan is simple.", "I don't speak English very well, sorry.",
])
def test_self_deprecation_positive(me: str) -> None:
    assert _p(_ctx("How was the launch?", me), "self_deprecation") >= 0.8


@pytest.mark.parametrize("me", [
    "English is my second language.", "Sorry I'm late.", "My English teacher was great.",
    "I don't know how to say this in English, but it is like a small bridge.",
])
def test_self_deprecation_negative(me: str) -> None:
    assert _p(_ctx("How was the launch?", me), "self_deprecation") < 0.5


@pytest.mark.parametrize(("me", "expected"), [
    ("What I mean is, the budget is smaller.", "paraphrase"),
    ("Let me put it another way: we need more time.", "paraphrase"),
    ("For example, last week the server stopped twice.", "example"),
    ("Do you mean the Monday meeting?", "asked_to_clarify"),
    ("Sorry, could you repeat that?", "asked_to_clarify"),
    ("We ship in May.", "none"),
])
def test_strategy_used(me: str, expected: str) -> None:
    ans = rule_judge(_ctx("Go on.", me), _coach())["strategy_used"]
    assert isinstance(ans, ChoiceAnswer) and ans.choice == expected
    assert abs(sum(ans.probabilities.values()) - 1.0) < 1e-6


def test_other_coach_questions_stay_neutral() -> None:
    res = rule_judge(_ctx("Go on.", "Sorry for my English."), _coach())
    word = res["word_misfit"]
    assert isinstance(word, NoulAnswer) and word.p == 0.5


def test_same_question_id_of_another_type_gets_no_pattern_answer() -> None:
    c = _coach()
    other = c.model_copy(update={"questions": {"repair_request": ScoreQuestion(
        instructions="x", criteria=["a", "b"])}})
    assert rule_judge(_ctx("Sorry?", "I said Monday."), other)["repair_request"].confidence == 0.2


# ---------- first-language hint ----------
def test_every_family_adds_examples_without_mutating() -> None:
    base = _coach()
    before = base.model_dump()
    targets = ("word_misfit", "time_or_who_unclear", "directness_fit")
    for family in FIRST_LANGUAGE_FAMILIES:
        hinted = with_first_language(base, family)
        changed = [q for q in targets if hinted.questions[q].instructions != base.questions[q].instructions]
        assert 1 <= len(changed) <= 3, family
        for q in changed:
            assert hinted.questions[q].instructions.startswith(base.questions[q].instructions)
        assert studio.validate_coach(hinted) == []
        assert hinted.nudge_rules == base.nudge_rules and hinted.nudge_policy == base.nudge_policy
    assert base.model_dump() == before


def test_family_specific_examples() -> None:
    base = _coach()
    assert "eventually" in with_first_language(base, "romance").questions["word_misfit"].instructions.lower()
    assert "blunt" in with_first_language(base, "slavic").questions["directness_fit"].instructions.lower()
    assert "time" in with_first_language(base, "sinitic").questions["time_or_who_unclear"].instructions.lower()
    jk = with_first_language(base, "japanese_korean").questions["directness_fit"].instructions.lower()
    assert "apolog" in jk


def test_no_family_returns_an_equal_copy() -> None:
    base = _coach()
    same = with_first_language(base, None)
    assert same == base and same is not base


def test_unknown_family_raises() -> None:
    with pytest.raises(ValueError):
        with_first_language(_coach(), "klingon")


def test_hint_only_touches_questions_the_coach_has() -> None:
    core = studio.default_coach()
    assert with_first_language(core, "romance") == core


def test_hint_text_avoids_banned_words() -> None:
    base = _coach()
    for family in FIRST_LANGUAGE_FAMILIES:
        hinted = with_first_language(base, family)
        for qid, q in hinted.questions.items():
            added = q.instructions[len(base.questions[qid].instructions):]
            assert not BANNED.search(added), (family, qid)


# ---------- route ----------
@pytest.fixture
def client() -> Iterator[TestClient]:
    from backend.main import app

    with TestClient(app) as c:
        yield c
        c.post("/coaches/core/activate")


def test_routes_list_and_serve_the_hint(client: TestClient) -> None:
    assert COACH_ID in [c["id"] for c in client.get("/coaches").json()]
    plain = client.get(f"/coaches/{COACH_ID}.json").json()
    hinted = client.get(f"/coaches/{COACH_ID}.json", params={"first_language_family": "romance"}).json()
    assert plain["questions"]["word_misfit"]["instructions"] != hinted["questions"]["word_misfit"]["instructions"]
    assert client.get(f"/coaches/{COACH_ID}.json", params={"first_language_family": "nope"}).status_code == 422


@pytest.mark.parametrize("prev", ["And then?", "So then what?", "Okay, and then?", "Really?", "Next?"])
def test_continuation_prompt_is_not_a_repair_request(prev: str) -> None:
    # "then" / "so" etc. in the wearer's earlier turn must not make a "go on" prompt an echo
    ctx = _ctx(prev, "Then we moved to Berlin.", earlier_me="So then I really left, and next we moved.")
    assert _p(ctx, "repair_request") < 0.5


def test_repair_request_judges_only_the_first_reply() -> None:
    first = _ctx("Sorry, could you say that again?", "I mean the new office in Berlin.")
    assert _p(first, "repair_request") >= 0.8
    # a second wearer turn after the same other turn already answered it: no new repair request
    reply = first.turn
    later = TurnFinalEvent(turn_id="m2", speaker="me", text="And it opens in May.", start=10.5, end=12.0, wpm=140)
    ctx = TurnContext(turn=later, prev_other_turn=first.prev_other_turn,
                      recent_turns=[*first.recent_turns, reply])
    assert _p(ctx, "repair_request") < 0.5
