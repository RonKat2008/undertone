"""Day recap: wording post-check, local-day bounds, aggregation, contrast, fallback, Gemini path,
caching and refresh, yesterday's goals, empty day, and the route over a real SQLite file."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend import wording
from backend.bus import Bus
from backend.contracts import DayRecap, DebriefNumbers, Person
from backend.db import DB
from backend.growth._writer import SessionSpec, write_session
from backend.recap import _build, _day, _llm
from backend.recap.routes import router
from backend.recap._facts import groups_for, read
from backend.recap._findings import contrast, findings, goals, headline, item_text
from backend.recap._llm import DraftLine, RecapDraft
from backend.state import AppState
from backend.studio.default import default_coach

ZONE = _day.parse_zone("America/Los_Angeles")
DAY = date(2026, 11, 14)
NOON = datetime(2026, 11, 14, 12, 0, tzinfo=ZONE.tz)
NOW = datetime(2026, 11, 14, 21, 0, tzinfo=ZONE.tz).timestamp()
CALM = ("I hear you, that sounds hard.", "What do you want to do next?", "That makes sense to me.",
        "How did the trip go?")
RUSHED = ("So I think maybe we should just ship it and I guess fix it later honestly.",
          "I guess maybe the plan is fine, I think maybe we can try.",
          "Maybe we just push it, I guess, I think maybe that works.")


def _write(db: DB, sid: str, at: datetime, person: str | None, *, inter: int, talk: float, q: int, wpm: float,
           fillers: float, wearer: tuple[str, ...], minutes: float = 10.0) -> None:
    n = DebriefNumbers(talk_ratio=talk, interruptions=inter, questions=q, fillers_per_min=fillers, wpm=wpm)
    write_session(db, SessionSpec(session_id=sid, started_at=at, numbers=n, person_id=person,
                                  wearer_texts=wearer, other_texts=("Mm, go on.",) * len(wearer),
                                  duration_s=minutes * 60))


def _priya(db: DB, sid: str = "p1", at: datetime = NOON) -> None:
    _write(db, sid, at, "priya", inter=0, talk=0.45, q=3, wpm=140, fillers=0.8, wearer=CALM)


def _alex(db: DB, sid: str = "a1", at: datetime = NOON + timedelta(hours=2)) -> None:
    _write(db, sid, at, "alex", inter=4, talk=0.8, q=0, wpm=185, fillers=5.0, wearer=RUSHED)


@pytest.fixture
def db(tmp_path: Path) -> Iterator[DB]:
    database = DB(tmp_path / "day.db")
    database.save_person(Person(person_id="priya", name="Priya"))
    database.save_person(Person(person_id="alex", name="Alex"))
    yield database
    database.close()


@pytest.fixture(autouse=True)
def no_llm(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Default: Gemini unavailable. Tests that want it replace generate_structured."""
    prompts: list[str] = []

    async def unavailable(prompt: str, schema: Any, **_: Any) -> Any:
        prompts.append(prompt)
        raise _llm.LLMUnavailable("no key in tests")

    monkeypatch.setattr(_llm, "generate_structured", unavailable)
    return prompts


async def _recap(db: DB, day: date = DAY, **kw: Any) -> DayRecap:
    return await _build.day_recap(db, day, ZONE, now=NOW, **kw)


def _all_text(r: DayRecap) -> list[str]:
    return [r.headline or "", *(i.text for i in r.went_well), *(i.text for i in r.work_on)]


# ---------- wording post-check ----------
@pytest.mark.parametrize("bad", [
    "You logged 0 interruptions across 181 seconds, holding a 95% talk ratio.",
    "Your session metrics look good.", "You took long turns with Alex.", "You spoke at 180 wpm.",
    "I think you did well.", "You cut in on person:alex twice.", "You are a bad listener.",
    "You spoke for most of this one and kept going and going and going without a single pause at all ok.",
])
def test_wording_rejects(bad: str) -> None:
    assert wording.problems(bad)


@pytest.mark.parametrize("good", [
    "You talked with Priya easily, but cut Alex off a few times.", "You let Priya finish every time. Nice.",
    "You spoke for most of this one.", 'You kept saying "I guess" with Alex.',
])
def test_wording_accepts(good: str) -> None:
    assert wording.problems(good, protected=["Priya", "Alex"]) == []


def test_wording_goal_rules() -> None:
    assert wording.problems("Pause for a breath before you answer Alex.", need_you=False) == []
    assert wording.problems("Ask at least one question in each chat.", need_you=False) == []
    assert wording.problems("Ask 2 questions in 3 chats.", need_you=False)


def test_repair_is_mechanical() -> None:
    assert wording.repair("  **you let them finish**  ") == "You let them finish."


def test_names_with_digits_are_protected() -> None:
    assert wording.problems("You asked R2 good questions.", protected=["R2"]) == []


# ---------- local day ----------
def test_local_day_bounds_and_dst() -> None:
    start, end = _day.bounds(DAY, ZONE)
    assert datetime.fromtimestamp(start, ZONE.tz).hour == 0 and end - start == 86_400
    s2, e2 = _day.bounds(date(2026, 11, 1), ZONE)  # clocks go back: a 25-hour day
    assert e2 - s2 == 25 * 3600


async def test_late_evening_counts_for_local_day_not_utc(db: DB) -> None:
    late = datetime(2026, 11, 13, 23, 30, tzinfo=ZONE.tz)  # 07:30 UTC on the 14th
    _priya(db, "late", late)
    assert (await _recap(db, date(2026, 11, 13), refresh=True)).ready
    today = await _recap(db)
    assert not today.ready and today.conversations == 0


# ---------- empty and thin days ----------
async def test_empty_day_is_not_ready(db: DB) -> None:
    r = await _recap(db)
    assert not r.ready and r.reason and "No conversations" in r.reason
    assert r.went_well == [] and r.goals == [] and r.headline is None


async def test_future_day_is_not_ready(db: DB) -> None:
    r = await _recap(db, DAY + timedelta(days=2))
    assert not r.ready and r.reason == _build.FUTURE


async def test_barely_spoke_is_not_ready(db: DB) -> None:
    _write(db, "tiny", NOON, "priya", inter=0, talk=0.05, q=0, wpm=120, fillers=0, wearer=("Yes.",), minutes=1)
    r = await _recap(db)
    assert not r.ready and r.reason == _build.TOO_LITTLE and r.conversations == 1


# ---------- aggregation, contrast, rule fallback ----------
async def test_rules_contrast_between_people(db: DB) -> None:
    _priya(db)
    _alex(db)
    r = await _recap(db)
    assert r.ready and r.generated_by == "rules" and r.conversations == 2 and set(r.people) == {"Priya", "Alex"}
    assert r.headline and "Priya" in r.headline and "Alex" in r.headline and "but" in r.headline
    assert r.went_well and r.work_on and 1 <= len(r.goals) <= 3
    assert all(i.person_name == "Alex" for i in r.work_on)
    assert all(i.session_id in ("p1", "a1") for i in [*r.went_well, *r.work_on])
    for text in _all_text(r):
        assert wording.problems(text, protected=["Priya", "Alex"]) == [], text
    for g in r.goals:
        assert wording.problems(g.text, protected=["Priya", "Alex"], need_you=False) == [], g.text


def test_hedges_counted_without_double_counting(db: DB) -> None:
    _alex(db)
    inp = _day.load_days(db, DAY, ZONE, NOW)
    g = groups_for(_day.on_day(inp.conversations, DAY, ZONE), {"alex": "Alex"}, {})[0]
    h = read(g, "hedges")
    assert h.verdict == "bad" and h.phrase in ("I think maybe", "I guess")


def test_no_contrast_when_numbers_do_not_differ(db: DB) -> None:
    _priya(db)
    _write(db, "p2", NOON + timedelta(hours=3), "alex", inter=0, talk=0.45, q=3, wpm=140, fillers=0.8, wearer=CALM)
    inp = _day.load_days(db, DAY, ZONE, NOW)
    groups = groups_for(_day.on_day(inp.conversations, DAY, ZONE), {"priya": "Priya", "alex": "Alex"}, {})
    good, bad = findings(groups)
    assert bad == [] and contrast(groups, bad) is None
    assert "but" not in headline(None, good, bad, True)
    assert goals(good, bad)[0].keep


def test_untagged_conversation_uses_topic_not_id(db: DB) -> None:
    _write(db, "sample_9", NOON, None, inter=4, talk=0.8, q=0, wpm=185, fillers=5.0, wearer=RUSHED)
    inp = _day.load_days(db, DAY, ZONE, NOW)
    groups = groups_for(_day.on_day(inp.conversations, DAY, ZONE), {}, {})
    _, bad = findings(groups)
    text = item_text(bad[0], False)
    assert "sample" not in text and "them" in text


# ---------- Gemini path and post-check ----------
def _good_draft(prompt: str) -> RecapDraft:
    keys = [k for k in ("good1", "good2", "good3", "work1", "work2", "work3", "goal1", "goal2", "goal3")
            if f"- {k}:" in prompt]
    ww = [DraftLine(key=k, text="You gave Priya lots of room and listened well.") for k in keys if "good" in k]
    wo = [DraftLine(key=k, text="You rushed and talked over Alex.") for k in keys if "work" in k]
    gl = [DraftLine(key=k, text="Breathe before you answer Alex.") for k in keys if "goal" in k]
    return RecapDraft(headline="You talked with Priya easily, but rushed with Alex.", went_well=ww, work_on=wo,
                      goals=gl)


async def test_gemini_wording_used_when_it_passes(db: DB, monkeypatch: pytest.MonkeyPatch) -> None:
    _priya(db)
    _alex(db)
    prompts: list[str] = []

    async def fake(prompt: str, schema: Any, **_: Any) -> RecapDraft:
        prompts.append(prompt)
        return _good_draft(prompt)

    monkeypatch.setattr(_llm, "generate_structured", fake)
    r = await _recap(db)
    assert r.generated_by == "gemini" and r.headline == "You talked with Priya easily, but rushed with Alex."
    assert len(prompts) == 1 and "Mm, go on" not in prompts[0] and "I guess maybe" not in prompts[0]


async def test_jargon_twice_falls_back_to_rules(db: DB, monkeypatch: pytest.MonkeyPatch) -> None:
    _priya(db)
    _alex(db)
    prompts: list[str] = []

    async def jargon(prompt: str, schema: Any, **_: Any) -> RecapDraft:
        prompts.append(prompt)
        d = _good_draft(prompt)
        return d.model_copy(update={"headline": "You logged a 95% talk ratio with Alex over 181 seconds."})

    monkeypatch.setattr(_llm, "generate_structured", jargon)
    r = await _recap(db)
    assert r.generated_by == "rules" and len(prompts) == 2 and "rejected" in prompts[1]
    assert "talk ratio" not in (r.headline or "")


async def test_misattributed_name_is_rejected(db: DB, monkeypatch: pytest.MonkeyPatch) -> None:
    _priya(db)
    _alex(db)

    async def wrong(prompt: str, schema: Any, **_: Any) -> RecapDraft:
        d = _good_draft(prompt)
        return d.model_copy(update={"work_on": [DraftLine(key=x.key, text="You rushed with Priya.")
                                                for x in d.work_on]})

    monkeypatch.setattr(_llm, "generate_structured", wrong)
    assert (await _recap(db)).generated_by == "rules"


# ---------- cache and refresh ----------
async def test_cache_reused_then_regenerated_on_new_conversation(db: DB, no_llm: list[str]) -> None:
    _priya(db)
    first = await _recap(db)
    calls = len(no_llm)
    again = await _recap(db)
    assert again.generated_at == first.generated_at and len(no_llm) == calls  # cached: no new LLM call
    _alex(db)
    third = await _recap(db)
    assert third.conversations == 2 and len(no_llm) > calls
    refreshed = await _recap(db, refresh=True)
    assert len(no_llm) > calls + 1 and refreshed.conversations == 2


# ---------- yesterday's goals ----------
async def test_yesterday_goals_judged_today(db: DB) -> None:
    _alex(db, "a0", NOON - timedelta(days=1))
    y = await _recap(db, DAY - timedelta(days=1))
    assert any(g.person_name == "Alex" for g in y.goals)
    today_empty = await _recap(db)
    assert today_empty.yesterday_goals and all(g.met is None for g in today_empty.yesterday_goals)
    assert "Alex" in today_empty.yesterday_goals[0].note
    _write(db, "a2", NOON, "alex", inter=0, talk=0.45, q=3, wpm=140, fillers=0.8, wearer=CALM)
    today = await _recap(db)
    assert today.yesterday_goals and all(g.met is True for g in today.yesterday_goals)
    _alex(db, "a3", NOON + timedelta(hours=1))
    worse = await _recap(db)
    assert any(g.met is False for g in worse.yesterday_goals)


async def test_yesterday_goals_from_uncached_day_are_built_once(db: DB) -> None:
    _alex(db, "a0", NOON - timedelta(days=1))
    first = await _recap(db)
    second = await _recap(db)
    assert [g.text for g in first.yesterday_goals] == [g.text for g in second.yesterday_goals]
    assert first.yesterday_goals


# ---------- route ----------
def test_route_shape_and_errors(db: DB) -> None:
    _priya(db)
    app = FastAPI()
    app.include_router(router, prefix="/reports")
    app.state.app = AppState(bus=Bus(), db=db, active_coach=default_coach())
    client = TestClient(app)
    ok = client.get("/reports/day", params={"date": "2026-11-14", "tz": "America/Los_Angeles"})
    assert ok.status_code == 200
    body = DayRecap.model_validate(ok.json())
    assert body.date == "2026-11-14" and body.timezone == "America/Los_Angeles"
    assert client.post("/reports/day/refresh", params={"date": "2026-11-14"}).status_code == 200
    assert client.get("/reports/day", params={"date": "14/11/2026"}).status_code == 422
    assert client.get("/reports/day", params={"tz": "Mars/Base"}).status_code == 422


# ---------- contract parity with contracts/events.ts ----------
@pytest.mark.parametrize("name", ["DayRecapItem", "DayGoal", "DayGoalCheck", "DayRecap"])
def test_day_recap_fields_match_ts(name: str) -> None:
    import re

    from backend import contracts as c
    src = (Path(__file__).resolve().parents[2] / "contracts" / "events.ts").read_text()
    match = re.search(r"export interface " + name + r" \{(.*?)\n\}", src, re.S)
    assert match and name in c.DAY_RECAP_TYPES
    assert set(getattr(c, name).model_fields) == set(re.findall(r"^\s+(\w+):", match.group(1), re.M))
