"""Daily mission (plan.md 4.0 + 4.9): one focus habit, one if-then plan, one near-term target.

Teaching rules: describe behaviour, never the person; compare only with the wearer's own past;
fewer than 3 past sessions -> a learning goal ("Try ... in one conversation", target 1 conversation);
3+ -> an outcome goal 15% better than the most recent day's level.

Learning vs outcome is derived from the stored text alone (DailyMission forbids extra fields):
every learning text starts with "Try " and no outcome text does. See `mission_kind`.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date
from statistics import mean
from typing import Literal

from backend.contracts import DailyMission, HabitProfile, MissionSuggestion
from backend.db import DB
from backend.growth._profile import compute_profile
from backend.growth._store import StoredSession, load_sessions, rule_label, utc_today

MissionKind = Literal["learning", "outcome"]
Measure = Callable[[StoredSession], float]

FOCUS_CHOICE_KEY = "growth.focus_choice"
LEARNING_PREFIX = "Try "
MIN_SESSIONS_FOR_OUTCOME = 3
IMPROVEMENT = 0.15  # plan.md: yesterday's level improved by 10-20%
MAX_SUGGESTIONS = 3
DEFAULT_FILLER = "um"
STARTER_FOCUS = "questions"
FALLBACK_FOCUS = "talk_share"
DEFAULT_SUGGESTIONS: tuple[str, ...] = ("questions", "fillers", "interrupt", "talk_share", "long_turn")
LONG_TURN_IDS: tuple[str, ...] = ("long_turn", "long_answer", "monologue")


@dataclass(frozen=True)
class Habit:
    """One focus habit. Texts use {t} for the target and {word} for the top crutch word."""
    label: str
    measure: Measure
    lower_is_better: bool
    if_then: str
    learning: str
    outcome: str
    suggestion: str
    decimals: int = 0  # 0 = whole numbers
    strict: bool = False  # True: "under {t}" (value < t); False: "{t} or fewer" / "at least {t}"
    percent: bool = False  # show the target as a percent (talk share)
    floor: float = 0.0  # never push a lower-is-better target below this


def _fires(*rule_ids: str) -> Measure:
    return lambda s: float(sum(s.fired(r) for r in rule_ids))


_FILLERS = Habit(
    label="Filler words", measure=lambda s: s.numbers.fillers_per_min, lower_is_better=True,
    if_then="When you feel '{word}' coming, pause for one beat instead.",
    learning="Try the pause-instead-of-'{word}' trick in one conversation",
    outcome="Keep fillers under {t} a minute in one conversation",
    suggestion="Replace '{word}' with a short pause.", decimals=1, strict=True)
_LONG_TURNS = Habit(
    label="Long turns", measure=_fires(*LONG_TURN_IDS), lower_is_better=True,
    if_then="When you have talked for about 30 seconds, end with a question.",
    learning="Try ending one long turn with a question in one conversation",
    outcome="Keep long turns to {t} or fewer in one conversation",
    suggestion="End a long turn with a question.")

CATALOGUE: dict[str, Habit] = {
    "fillers": _FILLERS,
    "filler": _FILLERS,
    "interrupt": Habit(
        label="Interrupting", measure=lambda s: float(s.numbers.interruptions), lower_is_better=True,
        if_then="When you notice they are mid-sentence, wait for them to finish, then count one beat.",
        learning="Try letting every sentence finish before you speak in one conversation",
        outcome="Keep interruptions to {t} or fewer in one conversation",
        suggestion="Let them finish, then count one beat."),
    "talk_share": Habit(
        label="Share of talking", measure=lambda s: s.numbers.talk_ratio, lower_is_better=True,
        if_then="When you finish a point, hand the turn back with a question.",
        learning="Try handing the turn back after each point in one conversation",
        outcome="Keep your share of the talking under {t} in one conversation",
        suggestion="Hand the turn back after each point.", decimals=2, strict=True, percent=True,
        floor=0.3),
    "long_turn": _LONG_TURNS,
    "long_answer": _LONG_TURNS,
    "monologue": _LONG_TURNS,
    "hedging": Habit(
        label="Hedging", measure=_fires("hedging"), lower_is_better=True,
        if_then="When you start with 'I think' or 'maybe', drop it and state the point plainly.",
        learning="Try giving one answer without 'I think' in one conversation",
        outcome="Keep hedges to {t} or fewer in one conversation",
        suggestion="State one point without 'I think'."),
    "pace": Habit(
        label="Pace", measure=lambda s: s.numbers.wpm, lower_is_better=True,
        if_then="When you start a new point, take one breath before the first word.",
        learning="Try one breath before each new point in one conversation",
        outcome="Keep your pace under {t} words a minute in one conversation",
        suggestion="Breathe before each new point.", strict=True, floor=120.0),
    "questions": Habit(
        label="Questions", measure=lambda s: float(s.numbers.questions), lower_is_better=False,
        if_then="When the other person finishes a point, ask a 'what' or 'how' question.",
        learning="Try asking 2 open questions in one conversation",
        outcome="Ask at least {t} questions in one conversation",
        suggestion="Ask one 'what' or 'how' question."),
}


def habit_for(focus_id: str) -> Habit:
    """Catalogue entry, or a generic one for unknown rule ids built from rule_label."""
    known = CATALOGUE.get(focus_id)
    if known is not None:
        return known
    what = rule_label(focus_id).lower()
    return Habit(
        label=rule_label(focus_id), measure=_fires(focus_id), lower_is_better=True,
        if_then=f"When you notice {what} starting, pause for one beat and reset.",
        learning=f"Try catching {what} once and pausing instead in one conversation",
        outcome=f"Keep {what} to {{t}} moments or fewer in one conversation",
        suggestion=f"Catch {what} and pause instead.")


def mission_kind(mission: DailyMission) -> MissionKind:
    return "learning" if mission.text.startswith(LEARNING_PREFIX) else "outcome"


# ---------- maths ----------
def _round_half_up(value: float, decimals: int) -> float:
    scale = 10 ** decimals
    return math.floor(value * scale + 0.5 + 1e-9) / scale


def _target(habit: Habit, level: float) -> float:
    """Yesterday's level improved by 15%, never a target that level already meets."""
    if not habit.lower_is_better:
        return float(max(_round_half_up(level * (1 + IMPROVEMENT), habit.decimals), math.floor(level) + 1))
    t = _round_half_up(level * (1 - IMPROVEMENT), habit.decimals)
    if not habit.strict:
        t = min(t, math.ceil(level) - 1)  # "t or fewer" must sit below the level
    return max(t, habit.floor, 0.0)


def _met(habit: Habit, value: float, target: float) -> bool:
    if not habit.lower_is_better:
        return value >= target
    return value < target if habit.strict else value <= target


def _show(habit: Habit, target: float) -> str:
    if habit.percent:
        return f"{round(target * 100)}%"
    return f"{target:.{habit.decimals}f}"


def _fill(text: str, word: str, target: str = "") -> str:
    return text.replace("{word}", word).replace("{t}", target)


def _group(focus_id: str) -> str:
    """Aliases (filler/fillers, long_turn/long_answer/monologue) count as one habit."""
    return "long_turn" if focus_id in LONG_TURN_IDS else "fillers" if focus_id == "filler" else focus_id


# ---------- focus + suggestions ----------
def _known_ids(sessions: Sequence[StoredSession], profile: HabitProfile) -> set[str]:
    seen = {n.rule_id for s in sessions for n in s.nudges}
    return {*CATALOGUE, *seen, *(i.rule_id for i in profile.recurring_issues)}


def _choose_focus(sessions: Sequence[StoredSession], profile: HabitProfile, preferred: str | None) -> str:
    if preferred and preferred in _known_ids(sessions, profile):
        return preferred
    issues = [i for i in profile.recurring_issues if i.rate > 0]
    if issues:
        return max(issues, key=lambda i: (i.rate, i.trend == "worse")).rule_id
    if profile.crutch_words:
        return "fillers"
    return STARTER_FOCUS if not sessions else FALLBACK_FOCUS


def _suggestions(focus: str, profile: HabitProfile, word: str) -> list[MissionSuggestion]:
    ranked = sorted((i for i in profile.recurring_issues if i.rate > 0), key=lambda i: -i.rate)
    picked: list[str] = []
    for candidate in (*(i.rule_id for i in ranked), *DEFAULT_SUGGESTIONS):
        if _group(candidate) != _group(focus) and _group(candidate) not in {_group(p) for p in picked}:
            picked = [*picked, candidate]
    return [MissionSuggestion(focus_rule_id=p, text=_fill(habit_for(p).suggestion, word))
            for p in picked[:MAX_SUGGESTIONS]]


# ---------- pure API ----------
def build_mission(sessions: Sequence[StoredSession], profile: HabitProfile, today: date,
                  preferred: str | None = None) -> DailyMission:
    """Today's mission from sessions before today (newest first, as load_sessions returns)."""
    past = [s for s in sessions if s.day < today]
    focus = _choose_focus(past, profile, preferred)
    habit = habit_for(focus)
    word = profile.crutch_words[0].word if profile.crutch_words else DEFAULT_FILLER
    common = {"date": today.isoformat(), "focus_rule_id": focus, "if_then": _fill(habit.if_then, word),
              "suggestions": _suggestions(focus, profile, word)}
    if len(past) < MIN_SESSIONS_FOR_OUTCOME:
        return DailyMission(text=_fill(habit.learning, word), target=1, **common)  # type: ignore[arg-type]
    last_day = max(s.day for s in past)
    level = mean(habit.measure(s) for s in past if s.day == last_day)
    target = _target(habit, level)
    return DailyMission(text=_fill(habit.outcome, word, _show(habit, target)), target=target,
                        **common)  # type: ignore[arg-type]


def apply_progress(mission: DailyMission, todays_sessions: Sequence[StoredSession],
                   kind: MissionKind | None = None) -> DailyMission:
    """Learning: count today's conversations. Outcome: best level today; done if any met the target."""
    if (kind or mission_kind(mission)) == "learning":
        count = len(todays_sessions)
        return mission.model_copy(update={"progress": count, "done": count >= mission.target})
    habit = habit_for(mission.focus_rule_id)
    values = [habit.measure(s) for s in todays_sessions]
    if not values:
        return mission.model_copy(update={"progress": 0, "done": False})
    best = min(values) if habit.lower_is_better else max(values)
    done = any(_met(habit, v, mission.target) for v in values)
    return mission.model_copy(update={"progress": round(best, 2), "done": done})


def choose_mission(mission: DailyMission, focus_rule_id: str, sessions: Sequence[StoredSession],
                   profile: HabitProfile, today: date) -> DailyMission:
    """Switch to one of the mission's suggestions; the old focus becomes a suggestion."""
    if focus_rule_id == mission.focus_rule_id:
        return mission
    if focus_rule_id not in {s.focus_rule_id for s in mission.suggestions}:
        raise ValueError(f"unknown focus {focus_rule_id!r}: pick one of the mission's suggestions")
    rebuilt = build_mission(sessions, profile, today, preferred=focus_rule_id)
    word = profile.crutch_words[0].word if profile.crutch_words else DEFAULT_FILLER
    old = MissionSuggestion(focus_rule_id=mission.focus_rule_id,
                            text=_fill(habit_for(mission.focus_rule_id).suggestion, word))
    rest = [s for s in rebuilt.suggestions if _group(s.focus_rule_id) != _group(old.focus_rule_id)]
    return rebuilt.model_copy(update={"date": mission.date, "suggestions": [old, *rest][:MAX_SUGGESTIONS]})


# ---------- DB wrappers ----------
def _inputs(db: DB) -> tuple[list[StoredSession], HabitProfile]:
    sessions = load_sessions(db)
    return sessions, db.load_profile() or compute_profile(sessions)


def _saved_progress(db: DB, mission: DailyMission, sessions: Sequence[StoredSession],
                    today: date) -> DailyMission:
    updated = apply_progress(mission, [s for s in sessions if s.day == today])
    db.save_mission(updated)
    return updated


def mission_today(db: DB, today: date | None = None) -> DailyMission:
    """Today's stored mission (built once per UTC day; later calls only update progress/done)."""
    day = today or utc_today()
    sessions, profile = _inputs(db)
    mission = db.load_mission(day.isoformat())
    if mission is None:
        choice = db.kv_get(FOCUS_CHOICE_KEY)
        mission = build_mission(sessions, profile, day, preferred=choice if isinstance(choice, str) else None)
    return _saved_progress(db, mission, sessions, day)


def choose_today(db: DB, focus_rule_id: str, today: date | None = None) -> DailyMission:
    """Switch today's focus to a suggestion (ValueError otherwise) and remember it for tomorrow."""
    day = today or utc_today()
    current = mission_today(db, day)
    sessions, profile = _inputs(db)
    chosen = choose_mission(current, focus_rule_id, sessions, profile, day)
    db.kv_set(FOCUS_CHOICE_KEY, focus_rule_id)
    return _saved_progress(db, chosen, sessions, day)
