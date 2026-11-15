"""Practice REST routes, storage, the no-key socket path, the band gate and contract parity."""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from backend import contracts as c
from backend.bus import Bus
from backend.db import DB
from backend.state import AppState
from backend.studio.default import default_coach
from backend.voice_practice import gate, router, store

EVENTS_TS = Path(__file__).resolve().parents[2] / "contracts" / "events.ts"


def _goal(measure: str = "fillers") -> c.PracticeGoal:
    return c.PracticeGoal(measure=measure, title="Fewer filler words", target="Under 3 a minute; you had 7",  # type: ignore[arg-type]
                          target_max=3.0, unit="filler words a minute", actual=7.0, from_answer=1, evidence="“um” ×4")


def _result(rid: str, started: str, overall: int, checks: list[c.PracticeGoalCheck] | None = None) -> c.PracticeResult:
    totals = c.PracticeTotals(answers=1, words=20, filler_count=2, hedges=0)
    answer = c.PracticeAnswer(index=1, question="Q?", text="Synthetic answer.", words=20)
    return c.PracticeResult(
        id=rid, coach_id="interview", coach_name="Interview", started_at=started, duration_s=120.0, overall=overall,
        summary="s", sub_scores=[c.PracticeSubScore(measure="pace", label="Pace", score=80, source="measured",
                                                    detail="150 words a minute")],
        strengths=[], goals=[_goal()], previous_goals=checks or [], answers=[answer], totals=totals,
        judged_by="rules")


@pytest.fixture
def client(tmp_path: Path) -> Iterator[tuple[TestClient, DB]]:
    db = DB(tmp_path / "practice.db")
    app = FastAPI()
    app.include_router(router)
    app.state.app = AppState(bus=Bus(), db=db, active_coach=default_coach())
    yield TestClient(app), db
    db.close()


def test_empty_history_and_goals(client: tuple[TestClient, DB]) -> None:
    api, _ = client
    assert api.get("/practice/results").json() == []
    assert api.get("/practice/goals").json() == {"result_id": None, "started_at": None, "coach_name": None,
                                                 "overall": None, "goals": []}
    assert api.get("/practice/results/nope").status_code == 404


def test_history_newest_first_and_latest_goals(client: tuple[TestClient, DB]) -> None:
    api, db = client
    check = c.PracticeGoalCheck(goal=_goal(), now=2.0, met=True, detail="Met")
    store.save_result(db, _result("a1", "2026-11-14T09:00:00+00:00", 61))
    store.save_result(db, _result("b2", "2026-11-14T11:00:00+00:00", 74, [check]))
    rows = api.get("/practice/results").json()
    assert [r["id"] for r in rows] == ["b2", "a1"]
    assert rows[0]["goals_met"] == 1 and rows[0]["goals_checked"] == 1 and rows[1]["goals_met"] is None
    goals = api.get("/practice/goals").json()
    assert goals["result_id"] == "b2" and goals["overall"] == 74 and goals["goals"][0]["target_max"] == 3.0
    full = api.get("/practice/results/a1").json()
    assert c.PracticeResult.model_validate(full).overall == 61


def test_table_is_additive(client: tuple[TestClient, DB]) -> None:
    _, db = client
    before = {r["name"] for r in db.query("SELECT name FROM sqlite_master WHERE type='table'")}
    store.ensure_table(db)
    after = {r["name"] for r in db.query("SELECT name FROM sqlite_master WHERE type='table'")}
    assert after - before <= {"practice_results"} and before <= after


def test_socket_without_key_reports_no_key(client: tuple[TestClient, DB]) -> None:
    api, _ = client
    with api.websocket_connect("/ws/practice") as ws:
        msg = ws.receive_json()
    assert msg["type"] == "practice.error" and msg["code"] == "no_key"
    assert not gate.practice_active()


def test_band_hearing_is_dropped_while_practice_runs() -> None:
    from backend.session import SessionController

    delivered: list[dict] = []
    ctl = SessionController.__new__(SessionController)  # only the hearing entry point is exercised
    ctl._hearing_gen, ctl.always_on, ctl.last_heard_at = 0, None, None
    ctl.deliver = delivered.append  # type: ignore[method-assign]
    turn = {"type": "turn.final", "turn_id": "t1", "speaker": "me", "text": "hi", "start": 0.0, "end": 1.0}
    assert gate.try_enter()
    try:
        ctl._on_hearing_event(turn)
        ctl._on_hearing_event({"type": "band.status", "connected": True, "transport": "sim", "mic_on": True})
    finally:
        gate.leave()
    ctl._on_hearing_event(turn)
    assert [e["type"] for e in delivered] == ["band.status", "turn.final"]


def _ts_fields(name: str) -> set[str]:
    match = re.search(r"export interface " + name + r" \{(.*?)\n\}", EVENTS_TS.read_text(), re.S)
    assert match, f"{name} missing from events.ts"
    return set(re.findall(r"^\s+(\w+):", match.group(1), re.M))


def _ts_union(name: str) -> set[str]:
    match = re.search(r"export type " + name + r" = ([^;]+);", EVENTS_TS.read_text())
    assert match, f"{name} missing from events.ts"
    return set(re.findall(r"'([a-z_]+)'", match.group(1)))


@pytest.mark.parametrize("name", c.PRACTICE_TYPES)
def test_practice_fields_match_ts(name: str) -> None:
    model: type[BaseModel] = getattr(c, name)
    assert set(model.model_fields) == _ts_fields(name)


@pytest.mark.parametrize("name", ["PracticeMeasure", "PracticeScoreSource", "PracticeJudge", "PracticeSpeaker",
                                  "PracticeErrorCode"])
def test_practice_unions_match_ts(name: str) -> None:
    assert set(getattr(c, name).__args__) == _ts_union(name)
