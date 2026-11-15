"""Spoken practice: measures, measured sub-scores, judge fallback, goals and goal carry-over."""

from __future__ import annotations

import pytest

from backend.contracts import PracticeGoal, PracticeResult
from backend.studio import load_prebuilt
from backend.voice_practice import judge as judge_mod
from backend.voice_practice.goals import build_goals, check_goal, check_previous
from backend.voice_practice.measure import AnswerRecord, TimedWord, measure_answer, totals
from backend.voice_practice.result import SessionFacts, build_result
from backend.voice_practice.score import measured_scores, overall

FILLERS = ["um", "uh", "like", "you know", "basically"]


def timed(text: str, start: float, step: float, pause_after: dict[int, float] | None = None) -> tuple[TimedWord, ...]:
    """Synthetic words, `step` seconds apart; pause_after adds a gap after word i."""
    out, t = [], start
    for i, w in enumerate(text.split()):
        out.append(TimedWord(w, round(t, 3), round(t + step * 0.8, 3)))
        t += step + (pause_after or {}).get(i, 0.0)
    return tuple(out)


def coach():  # type: ignore[no-untyped-def]
    return next(c for c in load_prebuilt() if c.id == "interview")


FAST_FILLER = ("um so basically I um led the um project and like we um shipped it in uh three weeks "
               "and um basically it went well you know")
CLEAN = ("I changed the team's mind with data. Churn was twelve percent, I showed the cohort chart, "
         "and we cut it to eight percent in two months.")


def test_measure_answer_counts_fillers_pace_pauses_and_start() -> None:
    rec = AnswerRecord(1, "Tell me about a project.", "so I led the project",
                       timed(FAST_FILLER, 10.0, 0.25, {5: 2.5}), coach_done_at=9.0)
    a = measure_answer(rec, FILLERS)
    assert a.words == len(FAST_FILLER.split())
    assert a.fillers.count("um") == FAST_FILLER.split().count("um") == 5 and "basically" in a.fillers and "you know" in a.fillers
    assert a.long_pauses == 1
    assert a.time_to_start_s == 1.0
    assert a.speaking_s is not None and a.wpm is not None and a.wpm > 170
    assert a.text.startswith("um so")  # the word stream's text, fillers kept


def test_measure_without_word_timings_leaves_timing_out() -> None:
    a = measure_answer(AnswerRecord(1, "Q?", "I would probably maybe do it", ()), FILLERS)
    assert a.words == 6 and a.speaking_s is None and a.wpm is None and a.fillers_per_min is None
    assert a.long_pauses is None and a.time_to_start_s is None
    assert "probably" in a.hedges and "maybe" in a.hedges


def test_barge_in_gives_no_time_to_start() -> None:
    a = measure_answer(AnswerRecord(1, "Q?", "", timed("yes I did", 5.0, 0.3), coach_done_at=6.0), FILLERS)
    assert a.time_to_start_s is None


def test_measured_scores_reward_clean_speech_and_penalise_fillers() -> None:
    clean = [measure_answer(AnswerRecord(1, "Q", "", timed(CLEAN, 0, 0.4)), FILLERS)]
    messy = [measure_answer(AnswerRecord(1, "Q", "", timed(FAST_FILLER, 0, 0.2)), FILLERS)]
    by = {s.measure: s for s in measured_scores(clean, totals(clean))}
    bad = {s.measure: s for s in measured_scores(messy, totals(messy))}
    assert by["fillers"].score == 100 and bad["fillers"].score < 30
    assert by["pace"].score > bad["pace"].score
    assert all(s.source == "measured" for s in [*by.values(), *bad.values()])
    assert "words a minute" in by["pace"].detail and "“um”" in bad["fillers"].detail


def test_no_timings_no_timed_subscores() -> None:
    ans = [measure_answer(AnswerRecord(1, "Q", "I led it and we shipped", ()), FILLERS)]
    measures = {s.measure for s in measured_scores(ans, totals(ans))}
    assert measures == {"confidence"}  # pace, fillers rate, length and start need timings


def test_overall_is_weighted_mean_of_available_scores() -> None:
    ans = [measure_answer(AnswerRecord(1, "Q", "", timed(CLEAN, 0, 0.4)), FILLERS)]
    scores = measured_scores(ans, totals(ans))
    assert 0 <= overall(scores) <= 100
    assert overall([]) == 0


def test_rule_judgement_scores_structure_and_sets_a_goal() -> None:
    ans = [measure_answer(AnswerRecord(1, "Q", "", timed(CLEAN, 0, 0.4)), FILLERS),
           measure_answer(AnswerRecord(2, "Q", "", timed(FAST_FILLER, 60, 0.2)), FILLERS)]
    j = judge_mod.rule_judgement(ans, measured_scores(ans, totals(ans)))
    assert j.judged_by == "rules" and j.structure.source == "rules"
    assert 40 <= j.structure.score <= 100
    assert j.structure_goal.measure == "structure" and j.structure_goal.from_answer == 2
    assert j.strengths


def test_goals_target_the_measured_weaknesses_with_numbers() -> None:
    ans = [measure_answer(AnswerRecord(1, "Q", "", timed(FAST_FILLER, 0, 0.2)), FILLERS)]
    t = totals(ans)
    scores = measured_scores(ans, t)
    structure = judge_mod.rule_judgement(ans, scores)
    goals = build_goals(ans, t, [structure.structure, *scores], structure.structure_goal)
    assert 2 <= len(goals) <= 4
    filler = next(g for g in goals if g.measure == "fillers")
    assert filler.target_max == 3.0 and filler.actual == t.fillers_per_min
    assert "you had" in filler.target and filler.from_answer == 1 and "“um”" in (filler.evidence or "")
    assert goals[0].measure == "fillers"  # weakest first


def _goal(measure: str, **kw: float) -> PracticeGoal:
    return PracticeGoal(measure=measure, title="t", target="x", unit="u", **kw)  # type: ignore[arg-type]


def test_goal_check_met_not_yet_and_unmeasured() -> None:
    assert check_goal(_goal("fillers", target_max=3.0, actual=7.0), 2.0).met is True
    assert "down from 7" in check_goal(_goal("fillers", target_max=3.0, actual=7.0), 2.0).detail
    assert check_goal(_goal("pace", target_min=120.0, target_max=165.0), 190.0).met is False
    unmeasured = check_goal(_goal("responsiveness", target_max=3.0), None)
    assert unmeasured.met is None and unmeasured.now is None


def test_check_previous_uses_this_sessions_numbers() -> None:
    ans = [measure_answer(AnswerRecord(1, "Q", "", timed(CLEAN, 0, 0.4)), FILLERS)]
    checks = check_previous([_goal("fillers", target_max=3.0, actual=7.0), _goal("structure", target_min=70.0)],
                            ans, totals(ans), structure=82.0)
    assert [c.met for c in checks] == [True, True]


async def test_build_result_falls_back_to_rules_and_checks_old_goals() -> None:
    old = (_goal("fillers", target_max=3.0, actual=7.0),)
    facts = SessionFacts(coach=coach(), started_at="2026-11-14T10:00:00+00:00", duration_s=200.0,
                         ended_early=False, previous_goals=old)
    recs = [AnswerRecord(1, "Tell me about a time.", "", timed(CLEAN, 5, 0.4), coach_done_at=4.0),
            AnswerRecord(2, "How would you approach it?", "", timed(FAST_FILLER, 60, 0.2), coach_done_at=57.0)]
    result = await build_result(facts, recs)
    assert isinstance(result, PracticeResult)
    assert result.judged_by == "rules" and len(result.answers) == 2
    assert 3 <= len(result.sub_scores) <= 6 and 2 <= len(result.goals) <= 4
    assert result.previous_goals[0].goal.measure == "fillers" and result.previous_goals[0].met is not None
    PracticeResult.model_validate(result.model_dump(mode="json"))


async def test_build_result_none_without_answers() -> None:
    facts = SessionFacts(coach=coach(), started_at="2026-11-14T10:00:00+00:00", duration_s=5.0, ended_early=True)
    assert await build_result(facts, [AnswerRecord(1, "Q", "", ())]) is None


async def test_gemini_judgement_is_used_for_structure_only(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake(prompt: str, schema, **_):  # type: ignore[no-untyped-def]
        assert "Measured numbers" in prompt
        return schema.model_validate({
            "structure_score": 77, "structure_reason": "You led with the point.", "summary": "Clear answers.",
            "strengths": [{"title": "Answer first", "detail": "You opened with the result.", "from_answer": 1},
                          {"title": "Bad index", "detail": "x", "from_answer": 9}],
            "structure_goal": {"title": "Land the result", "target": "End with what changed", "from_answer": 2,
                               "evidence": "it went well"},
        })

    monkeypatch.setattr(judge_mod, "generate_structured", fake)
    facts = SessionFacts(coach=coach(), started_at="2026-11-14T10:00:00+00:00", duration_s=90.0, ended_early=False)
    recs = [AnswerRecord(1, "Q1", "", timed(CLEAN, 0, 0.4)), AnswerRecord(2, "Q2", "", timed(FAST_FILLER, 40, 0.2))]
    result = await build_result(facts, recs)
    assert result is not None and result.judged_by == "gemini"
    structure = next(s for s in result.sub_scores if s.measure == "structure")
    assert structure.score == 77 and structure.source == "judged"
    assert all(s.source == "measured" for s in result.sub_scores if s.measure != "structure")
    assert result.strengths[1].from_answer is None  # an answer number that does not exist is dropped
