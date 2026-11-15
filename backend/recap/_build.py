"""Assemble a DayRecap: load the local day, pick findings in code, word them (Gemini, else rules),
cache, and judge yesterday's goals on the day's conversations. Never fabricates: a day without
enough talking returns ready=False with a plain reason.
"""

from __future__ import annotations

import asyncio
import time
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta

from backend.contracts import DayGoalCheck, DayRecap, DayRecapItem
from backend.db import DB
from backend.graph._rows import GraphInput
from backend.recap import _day, _llm, _store
from backend.recap._facts import Group, groups_for
from backend.recap._findings import (
    Finding, GoalPick, contrast, day_has_evidence, findings, goals, headline, item_text,
)
from backend.recap._goals import GoalSpec, check_all

NONE_TODAY = "No conversations yet today. Talk with someone while Undertone listens, and your recap shows up here."
NONE_THAT_DAY = "There were no conversations that day."
FUTURE = "That day has not happened yet."
TOO_LITTLE = "You barely spoke today. A few minutes of talking gives the coach enough to go on."

_locks: dict[tuple[str, str], asyncio.Lock] = {}


@dataclass(frozen=True)
class DayInput:
    day: date
    zone: _day.Zone
    now: float
    groups: tuple[Group, ...]
    yesterday: tuple[Group, ...]
    fingerprint: str


def _groups(inp: GraphInput, day: date, zone: _day.Zone) -> tuple[Group, ...]:
    convs = _day.on_day(inp.conversations, day, zone)
    kinds = {pid: r.kind for pid, r in inp.relationships}
    return tuple(groups_for(convs, dict(inp.people), kinds))


def load_day(db: DB, day: date, zone: _day.Zone, now: float) -> DayInput:
    inp = _day.load_days(db, day - timedelta(days=1), zone, now)
    groups = _groups(inp, day, zone)
    convs = [c for g in groups for c in g.convs]
    return DayInput(day=day, zone=zone, now=now, groups=groups,
                    yesterday=_groups(inp, day - timedelta(days=1), zone),
                    fingerprint=_store.fingerprint(convs, zone.name))


def _item(f: Finding, text: str) -> DayRecapItem:
    g = f.group
    return DayRecapItem(text=text, person_id=g.person_id, person_name=g.name, topic_id=g.topic_id,
                        topic_label=g.topic_label, session_id=f.session_id)


def _spec(p: GoalPick, text: str) -> GoalSpec:
    g = p.group
    return GoalSpec(text=text, measure=p.measure, keep=p.keep, person_id=g.person_id if g else None,
                    person_name=g.name if g else None, phrase=p.phrase)


def _base(d: DayInput) -> DayRecap:
    convs = [c for g in d.groups for c in g.convs]
    people = list(dict.fromkeys(g.name for g in d.groups if g.name))
    return DayRecap(date=d.day.isoformat(), timezone=d.zone.name, ready=False, conversations=len(convs),
                    people=people)


def not_ready_reason(d: DayInput) -> str | None:
    if d.day > _day.today(d.zone, d.now):
        return FUTURE
    if not d.groups:
        return NONE_TODAY if d.day == _day.today(d.zone, d.now) else NONE_THAT_DAY
    if not day_has_evidence(d.groups):
        return TOO_LITTLE
    return None


def _ordered(found: Sequence[Finding], worded: dict[str, str]) -> list[DayRecapItem]:
    by_key = {f.key: f for f in found}
    return [_item(by_key[k], t) for k, t in worded.items()]


async def compose(d: DayInput, *, use_llm: bool = True) -> _store.StoredRecap:
    """The recap for a day that has enough talking (callers check not_ready_reason first)."""
    groups = [g for g in d.groups if g.has_evidence]
    multiple = len(groups) > 1
    good, bad = findings(groups)
    picks = goals(good, bad)
    con = contrast(groups, bad)
    rule_headline = headline(con, good, bad, multiple)
    worded = await _llm.word(groups, good, bad, picks, con, rule_headline) if use_llm else None
    base = _base(d).model_copy(update={"ready": True, "generated_at": round(time.time(), 3)})
    if worded is not None:
        recap = base.model_copy(update={
            "headline": worded.headline, "went_well": _ordered(good, worded.went_well),
            "work_on": _ordered(bad, worded.work_on),
            "goals": [_spec(p, worded.goals[p.key]).public() for p in picks], "generated_by": "gemini"})
        specs = [_spec(p, worded.goals[p.key]) for p in picks]
    else:
        recap = base.model_copy(update={
            "headline": rule_headline, "went_well": [_item(f, item_text(f, multiple)) for f in good],
            "work_on": [_item(f, item_text(f, multiple)) for f in bad],
            "goals": [_spec(p, p.text).public() for p in picks], "generated_by": "rules"})
        specs = [_spec(p, p.text) for p in picks]
    return _store.StoredRecap(recap=recap, goal_specs=specs)


async def _yesterday_specs(db: DB, d: DayInput) -> list[GoalSpec]:
    """The goals given for the day before: the cached recap's, else a rule recap built now (and cached,
    so the same goals are shown for that day from then on)."""
    prev = d.day - timedelta(days=1)
    found = await asyncio.to_thread(_store.load, db, prev.isoformat(), d.zone.name)
    if found is not None:
        return found[1].goal_specs
    yd = DayInput(day=prev, zone=d.zone, now=d.now, groups=d.yesterday, yesterday=(),
                  fingerprint=_store.fingerprint([c for g in d.yesterday for c in g.convs], d.zone.name))
    if not_ready_reason(yd) is not None:
        return []
    stored = await compose(yd, use_llm=False)
    if not stored.goal_specs:
        return []
    await asyncio.to_thread(_store.save, db, prev.isoformat(), d.zone.name, yd.fingerprint, stored, d.now)
    return stored.goal_specs


def _judged(specs: Sequence[GoalSpec], d: DayInput) -> list[DayGoalCheck]:
    return check_all(specs, [g for g in d.groups if g.has_evidence])


async def day_recap(db: DB, day: date | None, zone: _day.Zone, *, refresh: bool = False,
                    now: float | None = None) -> DayRecap:
    when = time.time() if now is None else now
    target = day or _day.today(zone, when)
    d = await asyncio.to_thread(load_day, db, target, zone, when)
    yesterday = _judged(await _yesterday_specs(db, d), d)
    reason = not_ready_reason(d)
    if reason is not None:
        return _base(d).model_copy(update={"reason": reason, "yesterday_goals": yesterday})
    key = (d.day.isoformat(), zone.name)
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        cached = None if refresh else await asyncio.to_thread(_store.load, db, *key)
        if cached is not None and cached[0] == d.fingerprint:
            stored = cached[1]
        else:
            stored = await compose(d)
            if not stored.recap.went_well and not stored.recap.work_on:  # nothing fair to say yet
                return _base(d).model_copy(update={"reason": TOO_LITTLE, "yesterday_goals": yesterday})
            await asyncio.to_thread(_store.save, db, key[0], key[1], d.fingerprint, stored, when)
    return stored.recap.model_copy(update={"yesterday_goals": yesterday})
