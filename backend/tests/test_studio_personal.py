from __future__ import annotations

from backend.contracts import CrutchWord, HabitProfile, RecurringIssue
from backend.studio.default import DEFAULT_FILLERS
from backend.studio.personal import build_personal_coach
from backend.studio.validate import validate_coach


def issue(rule_id: str, rate: float, trend: str = "same") -> RecurringIssue:
    return RecurringIssue(rule_id=rule_id, label=f"label {rule_id}", rate=rate, trend=trend)  # type: ignore[arg-type]


def rule_ids(profile: HabitProfile) -> list[str]:
    return [r.id for r in build_personal_coach(profile).nudge_rules]


def test_empty_profile_is_valid_starter() -> None:
    spec = build_personal_coach(HabitProfile())
    assert validate_coach(spec) == []
    assert spec.kind == "personal" and spec.id == "personal"
    assert spec.name == "Personal coach (starter)"
    assert spec.filler_words == DEFAULT_FILLERS
    assert spec.nudge_policy.focus_rule_id in rule_ids(HabitProfile())
    assert "default habits" in spec.goal


def test_crutch_words_dedupe_and_focus_filler() -> None:
    profile = HabitProfile(sessions=3, crutch_words=[
        CrutchWord(word="like", per_min=9.0), CrutchWord(word="um", per_min=4.0),
        CrutchWord(word="Like", per_min=1.0), CrutchWord(word=" ", per_min=2.0)])
    spec = build_personal_coach(profile)
    assert validate_coach(spec) == []
    assert spec.filler_words == ["like", "um"] and spec.keyterms == ["like", "um"]
    assert spec.nudge_policy.focus_rule_id == "filler"
    filler = next(r for r in spec.nudge_rules if r.id == "filler")
    assert filler.when == "metrics.fillers_per_min > 4"
    assert filler.message == "Pause instead of 'like'"
    assert spec.name == "Your personal coach" and "'like', 'um'" in spec.goal


def test_long_crutch_word_falls_back_to_short_message() -> None:
    spec = build_personal_coach(HabitProfile(sessions=1, crutch_words=[
        CrutchWord(word="at the end of the day basically", per_min=3.0)]))
    assert validate_coach(spec) == []
    assert next(r for r in spec.nudge_rules if r.id == "filler").message == "Pause instead"


def test_unknown_issue_skipped_and_worse_focus() -> None:
    profile = HabitProfile(sessions=4, recurring_issues=[
        issue("interrupt", 3, "worse"), issue("pace", 5), issue("unknown_x", 9, "worse")])
    spec = build_personal_coach(profile)
    ids = [r.id for r in spec.nudge_rules]
    assert validate_coach(spec) == []
    assert "interrupt" in ids and "pace" in ids and "unknown_x" not in ids
    assert spec.nudge_policy.focus_rule_id == "interrupt"


def test_focus_is_highest_rate_when_nothing_worse() -> None:
    spec = build_personal_coach(HabitProfile(sessions=2, recurring_issues=[
        issue("interrupt", 3), issue("pace", 5)]))
    assert spec.nudge_policy.focus_rule_id == "pace"


def test_prebuilt_rule_pulls_in_its_question() -> None:
    spec = build_personal_coach(HabitProfile(sessions=2, recurring_issues=[
        issue("bury_the_answer", 4, "worse"), issue("missing_result", 2)]))
    assert validate_coach(spec) == []
    assert "bury_the_answer" in [r.id for r in spec.nudge_rules]
    assert {"bottom_line_first", "missing_result"} <= set(spec.questions)
    assert spec.nudge_policy.focus_rule_id == "bury_the_answer"


def test_listener_rules_validate_and_cooldowns_tightened() -> None:
    spec = build_personal_coach(HabitProfile(sessions=2, recurring_issues=[
        issue("self_redirect", 4), issue("talk_share", 3), issue("long_answer", 2),
        issue("hedge", 1), issue("monologue", 0.5)]))
    assert validate_coach(spec) == []
    assert len(spec.nudge_rules) == 5  # top 4 issues + filler
    assert all(r.enabled and r.cooldown_s is not None and r.cooldown_s <= 30 for r in spec.nudge_rules)


def test_fillers_issue_maps_to_filler_rule_without_duplicates() -> None:
    ids = rule_ids(HabitProfile(sessions=2, recurring_issues=[
        issue("fillers", 6, "worse"), issue("fillers", 2)]))
    assert ids.count("filler") == 1


def test_policy_numbers_and_fixed_fields() -> None:
    spec = build_personal_coach(HabitProfile(sessions=1, recurring_issues=[issue("pace", 1)]))
    p = spec.nudge_policy
    assert (p.budget_per_session, p.min_gap_s, p.tolerance, p.silent) == (8, 30, 0.15, False)
    assert spec.confidence_threshold == 0.8
    assert [r.id for r in spec.motion_rules] == ["fidget"]
    assert len(spec.drill.prompts) == 3 and spec.debrief_rubric


def test_all_known_issue_ids_validate() -> None:
    ids = ["interrupt", "monologue", "hedge", "pace", "hedging", "long_answer", "bury_the_answer",
           "missing_result", "vague_numbers", "talk_share", "long_turn", "self_redirect",
           "no_acknowledgement", "unsolicited_advice"]
    for rid in ids:
        spec = build_personal_coach(HabitProfile(sessions=1, recurring_issues=[issue(rid, 2, "worse")]))
        assert validate_coach(spec) == [], rid
        assert spec.nudge_policy.focus_rule_id == rid


def test_input_not_mutated_and_deterministic() -> None:
    profile = HabitProfile(sessions=2, crutch_words=[CrutchWord(word="um", per_min=3.0)],
                           recurring_issues=[issue("interrupt", 3, "worse")])
    before = profile.model_copy(deep=True)
    first = build_personal_coach(profile)
    assert profile == before
    assert first == build_personal_coach(profile)
