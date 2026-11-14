"""Deterministic personal coach: turns a HabitProfile into a practice-mode CoachSpec."""

from __future__ import annotations

import json
import re
from pathlib import Path

from backend.contracts import (
    CoachQuestion, CoachSpec, Drill, HabitProfile, NudgePolicy, NudgeRule, RecurringIssue,
)
from backend.studio.default import default_coach
from backend.studio.validate import MAX_MESSAGE_CHARS

PREBUILT_DIR = Path(__file__).parent / "prebuilt"
PREBUILT_NAMES = ("interview", "listener")
MAX_WORDS = 6
MAX_ISSUES = 4
MAX_COOLDOWN_S = 30.0
FILLER_RULE_ID = "filler"
FILLER_WHEN = "metrics.fillers_per_min > 4"
ISSUE_ALIASES = {"fillers": FILLER_RULE_ID}
JUDGE_REF = re.compile(r"judge\.(\w+)\.")

RUBRIC = (
    "This is practice, not a performance review. Lead with one concrete fact about what the "
    "wearer did, never a trait. Name one real strength, then exactly one habit to work on, "
    "phrased as an if-then plan ('If I feel an um coming, then I pause and breathe'). "
    "Compare only with the wearer's own past sessions, never with other people or an ideal."
)
DRILL = Drill(
    partner_persona=("A curious, patient friend who keeps asking open follow-ups and lets you "
                     "talk at length without interrupting."),
    prompts=[
        "Tell me about the best thing that happened to you this month, in as much detail as you like.",
        "Explain something you know well to me as if I were new to it, and take your time.",
        "Walk me through a decision you are still unsure about and how you are weighing it.",
    ],
)


def _filler_message(word: str | None) -> str:
    message = f"Pause instead of '{word}'" if word else "Pause instead"
    return message if len(message) <= MAX_MESSAGE_CHARS else "Pause instead"


def _top_words(profile: HabitProfile) -> list[str]:
    seen: set[str] = set()
    words: list[str] = []
    for crutch in sorted(profile.crutch_words, key=lambda c: -c.per_min):
        word = crutch.word.strip()
        if word and word.lower() not in seen:
            seen.add(word.lower())
            words.append(word)
    return words[:MAX_WORDS]


def _prebuilt_coaches() -> list[CoachSpec]:
    return [CoachSpec.model_validate(json.loads((PREBUILT_DIR / f"{n}.json").read_text()))
            for n in PREBUILT_NAMES]


def _rule_library(base: CoachSpec) -> tuple[dict[str, NudgeRule], dict[str, CoachQuestion]]:
    """Known rules by id plus the questions they need. First definition wins
    (default coach, then interview, then listener); "filler" is built separately."""
    rules: dict[str, NudgeRule] = {}
    questions: dict[str, CoachQuestion] = {}
    for coach in [base, *_prebuilt_coaches()]:
        for rule in coach.nudge_rules:
            if rule.id in rules or rule.id == FILLER_RULE_ID:
                continue
            rules[rule.id] = rule
            for qid in JUDGE_REF.findall(rule.when):
                if qid in coach.questions:
                    questions[qid] = coach.questions[qid]
    return rules, questions


def _tighten(rule: NudgeRule) -> NudgeRule:
    cooldown = MAX_COOLDOWN_S if rule.cooldown_s is None else min(rule.cooldown_s, MAX_COOLDOWN_S)
    return rule.model_copy(update={"enabled": True, "cooldown_s": cooldown})


def _top_issues(profile: HabitProfile, known: set[str]) -> list[RecurringIssue]:
    """Worst-first, de-duplicated by rule id, unknown rules dropped, capped."""
    issues: list[RecurringIssue] = []
    seen: set[str] = set()
    for issue in sorted(profile.recurring_issues, key=lambda i: -i.rate):
        rid = ISSUE_ALIASES.get(issue.rule_id, issue.rule_id)
        if rid in seen or rid not in known:
            continue
        seen.add(rid)
        issues.append(issue.model_copy(update={"rule_id": rid}))
    return issues[:MAX_ISSUES]


def _pick_focus(issues: list[RecurringIssue], has_words: bool) -> str:
    worse = [i for i in issues if i.trend == "worse"]
    if worse:
        return worse[0].rule_id
    if issues:
        return issues[0].rule_id
    return FILLER_RULE_ID if has_words else "interrupt"


def _goal(issues: list[RecurringIssue], words: list[str]) -> str:
    parts: list[str] = []
    if issues:
        parts.append("Drill your own habits: " + ", ".join(i.label for i in issues))
    if words:
        quoted = ", ".join(f"'{w}'" for w in words[:2])
        parts.append(f"catch {quoted} and replace them with a pause")
    if not parts:
        return "Drill the core habits until your history shows a clear pattern of your own."
    text = "; ".join(parts) + "."
    return text[0].upper() + text[1:]


def build_personal_coach(profile: HabitProfile) -> CoachSpec:
    base = default_coach()
    words = _top_words(profile)
    library, library_questions = _rule_library(base)
    issues = _top_issues(profile, set(library) | {FILLER_RULE_ID})
    filler = NudgeRule(id=FILLER_RULE_ID, when=FILLER_WHEN, haptic="filler",
                       message=_filler_message(words[0] if words else None),
                       cooldown_s=MAX_COOLDOWN_S, enabled=True)
    focus = _pick_focus(issues, bool(words))
    wanted = [i.rule_id for i in issues if i.rule_id != FILLER_RULE_ID]
    if focus == "interrupt" and "interrupt" not in wanted:
        wanted.append("interrupt")
    chosen = [_tighten(library[rid]) for rid in wanted]
    needed = {q for r in chosen for q in JUDGE_REF.findall(r.when)}
    questions = {q: v for q, v in library_questions.items() if q in needed}
    for qid in needed - set(questions):
        questions[qid] = base.questions[qid]
    starter = profile.sessions == 0 and not words and not profile.recurring_issues
    fillers = words or list(base.filler_words)
    if starter:
        name = "Personal coach (starter)"
        goal = ("Uses the default habits until you have a few sessions of history; "
                "then it drills your own.")
    else:
        name, goal = "Your personal coach", _goal(issues, words)
    return CoachSpec(
        id="personal", name=name, goal=goal, kind="personal", confidence_threshold=0.8,
        keyterms=list(fillers), filler_words=list(fillers), questions=questions,
        nudge_rules=[*chosen, filler], motion_rules=[r.model_copy() for r in base.motion_rules],
        nudge_policy=NudgePolicy(focus_rule_id=focus, budget_per_session=8, min_gap_s=30,
                                 tolerance=0.15, silent=False),
        debrief_rubric=RUBRIC, drill=DRILL.model_copy(deep=True),
    )
