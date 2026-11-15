"""Pure selection of what the day recap says: went-well and work-on findings, the one contrast
between two people the numbers support, and tomorrow's goals. Also the rule wording (the fallback,
and the meaning the LLM is asked to put into its own words).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from backend.graph._rows import Conversation
from backend.recap._facts import REPORT_METRIC, Group, MeasureKey, Reading, read, readings
from backend.reports._measures import CLEAR_RATIO, MIN_ABS, measure

MAX_ITEMS = 3
NAMED_BONUS = 0.2  # prefer findings about a named person over an untagged conversation
EASY_MIN_GOOD = 2  # "talked with X easily" needs at least this many good readings and no bad one

# measure -> (good phrase, bad phrase); {who} is a name or "them", {where} an optional place.
PHRASES: dict[MeasureKey, tuple[str, str]] = {
    "interrupt": ("let {who} finish every time{where}", "cut {who} off a few times{where}"),
    "share_high": ("gave {who} plenty of room to talk{where}", "did most of the talking with {who}{where}"),
    "share_low": ("", "barely spoke up with {who}{where}"),
    "questions": ("asked {who} good questions{where}", "did not ask {who} any questions{where}"),
    "pace": ("kept a calm pace with {who}{where}", "rushed when you talked with {who}{where}"),
    "fillers": ("spoke clearly with {who}{where}", "used lots of filler words with {who}{where}"),
    "hedges": ("", 'kept saying "{phrase}" with {who}{where}'),
}
# measure -> (goal with a name, goal without one); "keep" goals when nothing needs work.
FIX_GOALS: dict[MeasureKey, tuple[str, str]] = {
    "interrupt": ("Let {who} finish before you speak.", "Let people finish before you speak."),
    "share_high": ("Ask {who} a question, then listen.", "Ask a question, then listen to the answer."),
    "share_low": ("Share one thing you think with {who}.", "Share one thing you think in each chat."),
    "questions": ("Ask {who} at least one question.", "Ask at least one question in each chat."),
    "pace": ("Take a breath before you answer {who}.", "Take a breath before you answer."),
    "fillers": ('Pause quietly instead of saying "um" with {who}.', 'Pause quietly instead of saying "um".'),
    "hedges": ('Say what you think to {who} without "{phrase}" first.', 'Say what you think without "{phrase}" first.'),
}
KEEP_GOALS: dict[MeasureKey, tuple[str, str]] = {
    "interrupt": ("Keep letting {who} finish.", "Keep letting people finish."),
    "share_high": ("Keep giving {who} room to talk.", "Keep giving people room to talk."),
    "questions": ("Keep asking {who} questions.", "Keep asking people questions."),
    "pace": ("Keep your calm pace with {who}.", "Keep your calm pace."),
    "fillers": ("Keep speaking clearly with {who}.", "Keep speaking clearly."),
}


@dataclass(frozen=True)
class Finding:
    key: str  # stable id for the LLM to point at, e.g. "good1"
    good: bool
    group: Group
    reading: Reading
    session_id: str | None  # the conversation that shows it best

    @property
    def score(self) -> float:
        return self.reading.strength + (NAMED_BONUS if self.group.name else 0.0)


@dataclass(frozen=True)
class Contrast:
    easy: Group
    hard: Finding  # the bad finding on the measure where the two clearly differ
    easy_reading: Reading
    talked_easily: bool  # the easy group had several good readings and no bad one


@dataclass(frozen=True)
class GoalPick:
    key: str  # "goal1"...
    measure: MeasureKey
    keep: bool  # a "keep doing this" goal (nothing needed work)
    group: Group | None  # None = about people in general
    phrase: str = ""  # hedges: the phrase to drop
    text: str = ""  # the rule wording


def who(group: Group | None) -> str:
    return group.name if group and group.name else "them"


def where(group: Group, multiple: bool) -> str:
    """Where an untagged conversation happened, so "them" is not ambiguous; "" for named people."""
    if group.name:
        return ""
    if group.topic_label:
        return f" in your chat about {group.topic_label}"
    return " in one chat" if multiple else ""


def phrase(f: Finding, multiple: bool) -> str:
    good, bad = PHRASES[f.reading.measure]
    template = good if f.good else bad
    return template.format(who=who(f.group), where=where(f.group, multiple), phrase=f.reading.phrase)


def item_text(f: Finding, multiple: bool) -> str:
    return f"You {phrase(f, multiple)}."


def _best_session(group: Group, m: MeasureKey, good: bool) -> str | None:
    metric = REPORT_METRIC.get(m)
    if not group.convs:
        return None
    if metric is None:
        return group.convs[-1].session_id
    scored = [(measure([c], metric), c) for c in group.convs]
    known = [(v, c) for v, c in scored if v is not None]
    if not known:
        return group.convs[-1].session_id
    lower_better = m in ("interrupt", "share_high", "pace", "fillers")
    pick_low = lower_better == good
    value, conv = (min if pick_low else max)(known, key=lambda vc: vc[0])
    return conv.session_id


def findings(groups: Sequence[Group]) -> tuple[list[Finding], list[Finding]]:
    """(went well, to work on), strongest first, at most one per measure and group."""
    good: list[Finding] = []
    bad: list[Finding] = []
    for g in groups:
        for r in readings(g):
            if r.verdict == "good" and PHRASES[r.measure][0]:
                good.append(Finding("", True, g, r, _best_session(g, r.measure, True)))
            elif r.verdict == "bad":
                bad.append(Finding("", False, g, r, _best_session(g, r.measure, False)))
    good.sort(key=lambda f: -f.score)
    bad.sort(key=lambda f: -f.score)
    good = [_keyed(f, f"good{i + 1}") for i, f in enumerate(_spread(good))]
    bad = [_keyed(f, f"work{i + 1}") for i, f in enumerate(_spread(bad))]
    return good, bad


def _spread(items: list[Finding]) -> list[Finding]:
    """Top items, at most two per group, so one person does not fill the whole list."""
    out: list[Finding] = []
    per_group: dict[str, int] = {}
    for f in items:
        if per_group.get(f.group.key, 0) >= 2:
            continue
        per_group[f.group.key] = per_group.get(f.group.key, 0) + 1
        out.append(f)
        if len(out) == MAX_ITEMS:
            break
    return out


def _keyed(f: Finding, key: str) -> Finding:
    return Finding(key, f.good, f.group, f.reading, f.session_id)


def clearly_differ(m: MeasureKey, a: float | None, b: float | None) -> bool:
    """The reports rule (backend/reports/_measures.py): ratio >= 1.25 and the absolute gap reached."""
    if a is None or b is None:
        return False
    metric = REPORT_METRIC.get(m)
    gap = abs(a - b)
    if metric is not None and gap < MIN_ABS.get(metric, 0.0):
        return False
    low, high = sorted((a, b))
    return low <= 0 < high or (low > 0 and high / low >= CLEAR_RATIO)


def contrast(groups: Sequence[Group], bad: Sequence[Finding]) -> Contrast | None:
    """The strongest "easy with A, trouble with B": two named people, B bad and A good on the same
    measure, with values that clearly differ. None when the numbers do not support one."""
    for hard in bad:  # strongest first
        if not hard.group.name:
            continue
        m = hard.reading.measure
        for g in groups:
            if g.key == hard.group.key or not g.name:
                continue
            r = read(g, m)
            if r.verdict == "good" and clearly_differ(m, r.value, hard.reading.value):
                all_r = readings(g)
                easy = sum(1 for x in all_r if x.verdict == "good") >= EASY_MIN_GOOD and not any(
                    x.verdict == "bad" for x in all_r)
                return Contrast(easy=g, hard=hard, easy_reading=r, talked_easily=easy)
    return None


def headline(c: Contrast | None, good: Sequence[Finding], bad: Sequence[Finding], multiple: bool) -> str:
    if c is not None:
        easy_name = c.easy.name or "them"
        first = (f"talked with {easy_name} easily" if c.talked_easily else
                 PHRASES[c.easy_reading.measure][0].format(who=easy_name, where="", phrase=""))
        return f"You {first}, but {phrase(c.hard, multiple)}."
    if good and bad:
        return f"You {phrase(good[0], multiple)}, but {phrase(bad[0], multiple)}."
    if good:
        return f"You {phrase(good[0], multiple)}. Nice."
    if bad:
        return f"Today you {phrase(bad[0], multiple)}."
    return "You had a steady day of talking."


def goal_text(pick: GoalPick) -> str:
    table = KEEP_GOALS if pick.keep else FIX_GOALS
    named, unnamed = table[pick.measure]
    if pick.group is not None and pick.group.name:
        return named.format(who=pick.group.name, phrase=pick.phrase)
    return unnamed.format(phrase=pick.phrase)


def goals(good: Sequence[Finding], bad: Sequence[Finding]) -> list[GoalPick]:
    """One goal per work-on finding (named people keep their name); a "keep" goal when none."""
    picks: list[GoalPick] = []
    seen: set[tuple[str, str]] = set()
    for f in bad:
        g = f.group if f.group.name else None
        ident = (f.reading.measure, g.key if g else "")
        if ident in seen:
            continue
        seen.add(ident)
        picks.append(GoalPick(key="", measure=f.reading.measure, keep=False, group=g, phrase=f.reading.phrase))
    if not picks:
        for f in good:
            if f.reading.measure in KEEP_GOALS:
                g = f.group if f.group.name else None
                picks.append(GoalPick(key="", measure=f.reading.measure, keep=True, group=g))
                break
    out: list[GoalPick] = []
    for i, p in enumerate(picks[:MAX_ITEMS]):
        keyed = GoalPick(key=f"goal{i + 1}", measure=p.measure, keep=p.keep, group=p.group, phrase=p.phrase)
        out.append(GoalPick(key=keyed.key, measure=p.measure, keep=p.keep, group=p.group, phrase=p.phrase,
                            text=goal_text(keyed)))
    return out


def day_has_evidence(groups: Sequence[Group]) -> bool:
    return any(g.has_evidence for g in groups)


def conversations_of(groups: Sequence[Group]) -> list[Conversation]:
    return [c for g in groups for c in g.convs]
