"""Yesterday's goals judged on a day's conversations. Pure.

A goal is met when the habit it targets did not show up as a problem that day (verdict good or ok)
in conversations with the same person (or in any conversation, for a goal without a person). When
there is nothing to judge it on (no talk with that person, too little speech) `met` is None and the
note says so plainly. Never guesses.
"""

from __future__ import annotations

from collections.abc import Sequence

from pydantic import BaseModel, ConfigDict

from backend.contracts import DayGoal, DayGoalCheck
from backend.recap._facts import Group, MeasureKey, read, whole_day

# measure -> (met note, not met note); {who} is a name or "people", {phrase} a hedge phrase.
NOTES: dict[MeasureKey, tuple[str, str]] = {
    "interrupt": ("You mostly let {who} finish.", "You still cut {who} off a few times."),
    "share_high": ("You gave {who} room to talk.", "You still did most of the talking with {who}."),
    "share_low": ("You spoke up more with {who}.", "You still stayed quiet with {who}."),
    "questions": ("You asked {who} questions.", "You did not ask {who} any questions."),
    "pace": ("You kept a calm pace with {who}.", "You still rushed with {who}."),
    "fillers": ("You kept filler words down.", "Filler words still crept in a lot."),
    "hedges": ("You said what you meant without hedging.", 'You still said "{phrase}" a lot.'),
}
NO_TALK = "You have not talked with {who} yet, so there is nothing to check."
TOO_LITTLE = "There was not enough talking to tell yet."


class GoalSpec(BaseModel):
    """INTERNAL, stored with a recap: a goal plus what it measures, so it can be judged later."""

    model_config = ConfigDict(extra="ignore")

    text: str
    measure: MeasureKey
    keep: bool = False
    person_id: str | None = None
    person_name: str | None = None
    phrase: str = ""

    def public(self) -> DayGoal:
        return DayGoal(text=self.text, person_id=self.person_id, person_name=self.person_name)


def _target(spec: GoalSpec, groups: Sequence[Group]) -> Group | None:
    if spec.person_id is None:
        convs = [c for g in groups for c in g.convs]
        return whole_day(convs) if convs else None
    return next((g for g in groups if g.person_id == spec.person_id), None)


def check(spec: GoalSpec, groups: Sequence[Group]) -> DayGoalCheck:
    name = spec.person_name or "people"
    base = DayGoalCheck(text=spec.text, person_id=spec.person_id, person_name=spec.person_name, met=None,
                        note="")
    target = _target(spec, groups)
    if target is None:
        note = NO_TALK.format(who=spec.person_name) if spec.person_name else TOO_LITTLE
        return base.model_copy(update={"note": note})
    reading = read(target, spec.measure)
    if reading.verdict is None:
        return base.model_copy(update={"note": TOO_LITTLE})
    met = reading.verdict != "bad"
    met_note, missed_note = NOTES[spec.measure]
    note = (met_note if met else missed_note).format(who=name, phrase=spec.phrase or "maybe")
    session = target.convs[-1].session_id if target.convs else None
    return base.model_copy(update={"met": met, "note": note, "session_id": session})


def check_all(specs: Sequence[GoalSpec], groups: Sequence[Group]) -> list[DayGoalCheck]:
    return [check(s, groups) for s in specs]
