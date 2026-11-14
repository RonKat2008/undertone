"""Tests for backend/debrief/rules.py and backend/debrief/local.py (no network)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.contracts import (
    BookmarkEvent, CoachSpec, DebriefNumbers, Metrics, SessionSummary, TimelinePoint, TurnFinalEvent,
)
from backend.debrief import local, rules
from backend.debrief.wire import BetterVersionDraft, BookmarkNote, DebriefDraft
from backend.state import SessionState

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / "fixtures" / "demo_session.jsonl"
PREBUILT = ROOT / "backend" / "studio" / "prebuilt"
MID_T04 = "Then on costs, like, bean prices have kind of gone up a lot, and labor too, and basically margins are getting squeezed."
T08 = "Um, got it, that helps. I'll send you the deck tonight with the full framework."
T06 = "Revenue first. How does the client define success for this turnaround?"


def load_coach(name: str) -> CoachSpec:
    return CoachSpec.model_validate(json.loads((PREBUILT / f"{name}.json").read_text()))


def fixture_turns() -> list[TurnFinalEvent]:
    turns: list[TurnFinalEvent] = []
    for line in FIXTURE.read_text().splitlines():
        if not line.strip():
            continue
        data = json.loads(line)
        if data.get("type") == "turn.final":
            data.pop("at", None)
            turns.append(TurnFinalEvent.model_validate(data))
    return turns


def make_session(coach_name: str = "interview", with_turns: bool = True) -> SessionState:
    coach = load_coach(coach_name)
    s = SessionState(session_id="s-test", coach=coach, mode="regular", policy=coach.nudge_policy,
                     started_at=1000.0)
    s.ended_at = 1092.0
    if with_turns:
        s.turns = fixture_turns()
        s.bookmarks = [BookmarkEvent(source="phone", ts=46.0),
                       BookmarkEvent(source="promise", text="Send the deck tonight", ts=86.0)]
    return s


@pytest.fixture
def session() -> SessionState:
    return make_session()


@pytest.fixture
def metrics() -> Metrics:
    return Metrics(talk_ratio=0.6789, interruptions=2, questions=1, fillers_per_min=7.46, wpm=170.6)


def good_draft(**overrides: object) -> DebriefDraft:
    base: dict[str, object] = dict(
        headline_fact="Your framework answer ran 49 seconds with 16 fillers; the goal was a direct answer.",
        strength='When asked to pick one branch, you said "Revenue first" and asked a clarifying question.',
        one_fix="In the framework answer you listed every branch and then went back on your choice.",
        if_then="When you finish listing branches, pick one and give one reason.",
        best_moment_quote=T06,
    )
    base.update(overrides)
    return DebriefDraft.model_validate(base)


# ---------- rules: basics ----------
def test_normalize_handles_curly_quotes_and_punctuation() -> None:
    assert rules.normalize("  “Revenue—first!”  I’m   SURE. ") == "revenue first i'm sure"


def test_numbers_in_digits_percent_and_words() -> None:
    assert rules.numbers_in("You talked 68% of the time, 7.5 per minute, three times") == [68.0, 7.5, 3.0]


def test_quotes_in_needs_two_words() -> None:
    text = 'He said "Pick one branch" and “Revenue first” and ‘no’ and "ok"'
    assert rules.quotes_in(text) == ["Pick one branch", "Revenue first"]


def test_wearer_texts(session: SessionState) -> None:
    texts = rules.wearer_texts(session)
    assert len(texts) == 4 and texts[2] == T06


def test_session_numbers_include_core_values(session: SessionState, metrics: Metrics) -> None:
    nums = rules.session_numbers(session, metrics)
    for n in (68, 2, 1, 7.5, 171, 4, 49, 16, 92, 2):
        assert float(n) in nums


# ---------- headline evidence ----------
def test_headline_evidence_number(session: SessionState, metrics: Metrics) -> None:
    assert rules.headline_has_evidence("You talked 68% of the time.", session, metrics)
    assert rules.headline_has_evidence("Your longest answer ran 49 seconds.", session, metrics)


def test_headline_evidence_quote(session: SessionState, metrics: Metrics) -> None:
    assert rules.headline_has_evidence("You ended on “it could possibly be costs, like, basically both”.",
                                       session, metrics)


def test_headline_evidence_fails(session: SessionState, metrics: Metrics) -> None:
    assert not rules.headline_has_evidence("Your answer went on for 300 seconds.", session, metrics)
    assert not rules.headline_has_evidence('You kept saying "things are great".', session, metrics)
    assert not rules.headline_has_evidence("You hedged a lot.", session, metrics)


# ---------- check_draft ----------
def test_check_draft_ok(session: SessionState, metrics: Metrics) -> None:
    assert rules.check_draft(good_draft(), session, metrics) == []


def test_check_draft_if_then(session: SessionState, metrics: Metrics) -> None:
    reasons = rules.check_draft(good_draft(if_then="Try to pick one branch."), session, metrics)
    assert any('if_then must start with "When" or "If"' in r and "Try to" in r for r in reasons)
    assert rules.check_draft(good_draft(if_then="If, after a branch, you pause, stop."), session, metrics) == []
    assert rules.check_draft(good_draft(if_then="When, mid-answer, you hedge, stop."), session, metrics) == []
    assert rules.check_draft(good_draft(if_then="when you hedge, stop."), session, metrics)
    assert rules.check_draft(good_draft(if_then="Whenever you hedge, stop."), session, metrics)


def test_check_draft_headline_without_evidence(session: SessionState, metrics: Metrics) -> None:
    reasons = rules.check_draft(good_draft(headline_fact="You hedged a lot today."), session, metrics)
    assert any("headline_fact" in r for r in reasons)


def test_check_draft_person_judging(session: SessionState, metrics: Metrics) -> None:
    reasons = rules.check_draft(good_draft(one_fix="You ramble when the question is open."), session, metrics)
    assert any("one_fix" in r and "you ramble" in r for r in reasons)
    reasons = rules.check_draft(good_draft(one_fix="You're a nervous person in interviews."), session, metrics)
    assert reasons


def test_person_judging_no_false_positive_on_coaching_text(session: SessionState, metrics: Metrics) -> None:
    draft = good_draft(one_fix="Your turns ran long before you handed the conversation back.",
                       strength='You said "Revenue first" and then asked how the client defines success.')
    assert rules.check_draft(draft, session, metrics) == []


def test_check_draft_other_people(session: SessionState, metrics: Metrics) -> None:
    reasons = rules.check_draft(good_draft(one_fix="You used more fillers than most people do."),
                                session, metrics)
    assert any("most people" in r for r in reasons)
    reasons = rules.check_draft(good_draft(vs_last_time="That beats the average speaker."), session, metrics)
    assert any("vs_last_time" in r for r in reasons)


def test_check_draft_generic_praise(session: SessionState, metrics: Metrics) -> None:
    reasons = rules.check_draft(good_draft(strength="Great job, you stayed engaged throughout."), session, metrics)
    assert any("strength" in r and "great job" in r for r in reasons)


def test_check_draft_word_limits_and_empty(session: SessionState, metrics: Metrics) -> None:
    long_fix = "Your answer " + "ran long and " * 12 + "then stopped."
    reasons = rules.check_draft(good_draft(one_fix=long_fix), session, metrics)
    assert any("one_fix" in r and "28" in r for r in reasons)
    reasons = rules.check_draft(good_draft(strength="  "), session, metrics)
    assert any("strength" in r and "empty" in r for r in reasons)


# ---------- verify_quote ----------
def test_verify_quote_exact(session: SessionState) -> None:
    wearer = rules.wearer_texts(session)
    assert rules.verify_quote('"Revenue first."', wearer) == "Revenue first."


def test_verify_quote_curly_and_punctuation_insensitive(session: SessionState) -> None:
    wearer = rules.wearer_texts(session)
    got = rules.verify_quote("“Revenue first, how does the client define success for this turnaround”", wearer)
    assert got == "Revenue first, how does the client define success for this turnaround"


def test_verify_quote_replaces_with_closest_sentence(session: SessionState) -> None:
    wearer = rules.wearer_texts(session)
    got = rules.verify_quote("How does the customer define success for the turnaround?", wearer)
    assert got == "How does the client define success for this turnaround?"
    assert rules.verify_quote("anything", []) == ""


# ---------- bookmark_snippet ----------
def test_bookmark_snippet_long_turn_midpoint(session: SessionState) -> None:
    snip = local.bookmark_snippet(session, 46.0)
    assert snip.startswith(MID_T04)
    assert len(snip) <= 240 and not snip.lower().startswith("me:")


def test_bookmark_snippet_short_turn(session: SessionState) -> None:
    assert local.bookmark_snippet(session, 86.0) == T08


def test_bookmark_snippet_outside_turns(session: SessionState) -> None:
    assert local.bookmark_snippet(session, 95.0) == "Perfect, talk soon."  # ended 89.9-91.2, within 10 s
    assert local.bookmark_snippet(session, 500.0) == "Perfect, talk soon."  # nearest
    assert local.bookmark_snippet(session, -20.0).startswith("Here's the case.")


def test_bookmark_snippet_empty_session() -> None:
    assert local.bookmark_snippet(make_session(with_turns=False), 10.0) == ""


def test_bookmark_snippet_trims_on_word_boundary(session: SessionState) -> None:
    snip = local.bookmark_snippet(session, 46.0, max_chars=60)
    assert 0 < len(snip) <= 60 and MID_T04.startswith(snip)


# ---------- numbers / focus ----------
def test_numbers_rounding(metrics: Metrics) -> None:
    n = local.numbers(metrics)
    assert n == DebriefNumbers(talk_ratio=0.68, interruptions=2, questions=1, fillers_per_min=7.5, wpm=171.0)


def test_focus_label(session: SessionState) -> None:
    assert local.focus_label(session) == "hedging"
    assert local.focus_label(make_session("listener")) == "interrupt"


# ---------- assemble ----------
def test_assemble_merges_local_parts(session: SessionState, metrics: Metrics) -> None:
    timeline = [TimelinePoint(t=0, wpm=0, volume_db=-60, hand_energy=0.5)]
    draft = good_draft(
        vs_last_time="Fillers dropped from 9.1 to 7.5 per minute.",
        best_moment_quote="“Revenue first, how does the client define success for this turnaround”",
        notes=["Case: coffee chain.", "  ", "Promise: deck tonight."],
        bookmarks=[BookmarkNote(index=1, what_happened="You promised the deck.", follow_up="Send the deck.")],
        better_version=BetterVersionDraft(original="I think maybe I would split profit into revenue and cost",
                                          rewritten="I'd split profit into revenue and costs."),
    )
    d = local.assemble(draft, session, metrics, timeline, None)
    assert d.numbers == local.numbers(metrics)
    assert d.timeline == timeline
    assert d.vs_last_time is None
    assert d.notes == ["Case: coffee chain.", "Promise: deck tonight."]
    assert d.best_moment_quote == "Revenue first, how does the client define success for this turnaround"
    b0, b1 = d.bookmarks
    assert (b0.ts, b0.source, b0.what_happened, b0.follow_up) == (46.0, "phone", "You marked this moment.", None)
    assert b0.snippet.startswith(MID_T04)
    assert (b1.ts, b1.source, b1.what_happened, b1.follow_up) == (86.0, "promise", "You promised the deck.",
                                                                  "Send the deck.")
    assert b1.snippet == T08
    assert d.better_version is not None
    assert d.better_version.original == fixture_turns()[3].text  # fixed up to the real t04 turn
    assert d.better_version.audio_url is None


def test_assemble_keeps_vs_last_and_real_original(session: SessionState, metrics: Metrics) -> None:
    last = SessionSummary(session_id="s-old", started_at="2026-11-13T10:00:00+00:00", duration_s=80,
                          coach_name="Interview", mode="regular", headline_fact="x",
                          numbers=DebriefNumbers(talk_ratio=0.7, interruptions=2, questions=0,
                                                 fillers_per_min=9.1, wpm=180))
    draft = good_draft(vs_last_time="Fillers dropped from 9.1 to 7.5 per minute.",
                       bookmarks=[BookmarkNote(index=0, what_happened="Costs came in without a number.")],
                       better_version=BetterVersionDraft(original="Revenue first.", rewritten="Revenue first."))
    d = local.assemble(draft, session, metrics, [], last)
    assert d.vs_last_time == "Fillers dropped from 9.1 to 7.5 per minute."
    assert d.bookmarks[0].what_happened == "Costs came in without a number."
    assert d.bookmarks[1].what_happened == "Send the deck tonight"
    assert d.bookmarks[1].follow_up == "Send the deck tonight"
    assert d.better_version is not None and d.better_version.original == "Revenue first."


def test_assemble_no_wearer_turns_drops_better_version(metrics: Metrics) -> None:
    s = make_session(with_turns=False)
    draft = good_draft(better_version=BetterVersionDraft(original="x y", rewritten="y"))
    d = local.assemble(draft, s, metrics, [], None)
    assert d.better_version is None and d.best_moment_quote == "" and d.bookmarks == []


# ---------- fallback ----------
def _as_draft(d: object) -> DebriefDraft:
    return DebriefDraft.model_validate(d.model_dump(include={  # type: ignore[attr-defined]
        "headline_fact", "strength", "one_fix", "if_then", "best_moment_quote", "vs_last_time", "notes"}))


@pytest.mark.parametrize("coach_name", ["interview", "listener", "clear_across"])
def test_fallback_rule_compliant(coach_name: str, metrics: Metrics) -> None:
    s = make_session(coach_name)
    last = SessionSummary(session_id="s-old", started_at="2026-11-13T10:00:00+00:00", duration_s=80,
                          coach_name="c", mode="regular", headline_fact="x",
                          numbers=DebriefNumbers(talk_ratio=0.7, interruptions=3, questions=0,
                                                 fillers_per_min=9.1, wpm=180))
    for prev in (None, last):
        d = local.fallback_debrief(s, metrics, [], prev)
        assert rules.check_draft(_as_draft(d), s, metrics) == []
        assert d.best_moment_quote in " ".join(rules.wearer_texts(s))
        assert (d.vs_last_time is None) == (prev is None)
        assert 2 <= len(d.notes) <= 4
        assert len(d.bookmarks) == 2 and d.bookmarks[1].follow_up == "Send the deck tonight"
        assert d.better_version is None


def test_fallback_interview_content(session: SessionState, metrics: Metrics) -> None:
    d = local.fallback_debrief(session, metrics, [], None)
    assert "49 seconds" in d.headline_fact
    assert T06 in d.strength
    assert d.if_then.startswith(("When", "If"))


def test_fallback_empty_session() -> None:
    s = make_session(with_turns=False)
    m = Metrics()
    d = local.fallback_debrief(s, m, [], None)
    assert rules.check_draft(_as_draft(d), s, m) == []
    assert d.best_moment_quote == "" and d.bookmarks == []
