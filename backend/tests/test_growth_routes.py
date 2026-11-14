"""Growth routes over a seeded temporary database (FastAPI TestClient, no lifespan, no keys)."""

from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.bus import Bus
from backend.db import DB
from backend.growth import router
from backend.growth._sample import seed
from backend.growth._store import utc_today
from backend.state import AppState
from backend.studio.default import default_coach


def _client(db: DB) -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.state.app = AppState(bus=Bus(), db=db, active_coach=default_coach())
    return TestClient(app)


@pytest.fixture
def seeded(tmp_path: Path) -> Iterator[TestClient]:
    db = DB(tmp_path / "seeded.db")
    seed(db, utc_today())
    yield _client(db)
    db.close()


@pytest.fixture
def empty(tmp_path: Path) -> Iterator[TestClient]:
    db = DB(tmp_path / "empty.db")
    yield _client(db)
    db.close()


def test_empty_database_gives_sensible_defaults(empty: TestClient) -> None:
    assert empty.get("/sessions").json() == []
    assert empty.get("/people").json() == []
    assert empty.get("/profile").json()["sessions"] == 0
    streak = empty.get("/streak").json()
    assert streak == {"days": 0, "freeze_available": True, "week": [False] * 7}
    mission = empty.get("/mission/today").json()
    assert mission["text"] and mission["if_then"].split()[0] in {"When", "If"}
    assert 2 <= len(mission["suggestions"]) <= 3
    report = empty.get("/report/weekly").json()
    assert report["trend"] == [] and report["best_session_id"] is None


def test_sessions_newest_first(seeded: TestClient) -> None:
    rows = seeded.get("/sessions").json()
    assert len(rows) >= 6
    starts = [r["started_at"] for r in rows]
    assert starts == sorted(starts, reverse=True)
    assert all(r["session_id"].startswith("sample_") for r in rows)
    assert all(r["person_id"] for r in rows)
    assert seeded.get("/sessions", params={"limit": 2}).json() == rows[:2]
    assert seeded.get("/sessions", params={"limit": 0}).status_code == 422


def test_profile_mission_streak_report(seeded: TestClient) -> None:
    profile = seeded.get("/profile").json()
    assert profile["sessions"] >= 6 and profile["baseline_wpm"]
    assert profile["crutch_words"] and profile["recurring_issues"]
    mission = seeded.get("/mission/today").json()
    assert mission["date"] == utc_today().isoformat()
    assert mission["target"] > 0
    assert seeded.get("/mission/today").json() == mission  # stable within the day
    streak = seeded.get("/streak").json()
    assert streak["days"] >= 1 and len(streak["week"]) == 7
    report = seeded.get("/report/weekly").json()
    assert {t["metric"] for t in report["trend"]} == {
        "talk_ratio", "interruptions", "questions", "fillers_per_min", "wpm"}
    assert all({"from", "to"} <= set(t) for t in report["trend"])
    assert report["best_session_id"] and report["biggest_improvement"]
    blob = json.dumps([profile, mission, streak, report]).lower()
    assert "broken" not in blob


def test_mission_choose(seeded: TestClient) -> None:
    mission = seeded.get("/mission/today").json()
    pick = mission["suggestions"][0]["focus_rule_id"]
    chosen = seeded.post("/mission/choose", json={"focus_rule_id": pick})
    assert chosen.status_code == 200
    assert chosen.json()["focus_rule_id"] == pick
    assert seeded.get("/mission/today").json()["focus_rule_id"] == pick
    assert seeded.post("/mission/choose", json={"focus_rule_id": "nope"}).status_code == 422
    assert seeded.post("/mission/choose", json={}).status_code == 422


def test_people_and_tagging(seeded: TestClient) -> None:
    people = seeded.get("/people").json()
    assert len(people) == 3
    assert all(p["sessions"] >= 1 and p["pattern"] and p["brief"] for p in people)
    sid = seeded.get("/sessions").json()[0]["session_id"]
    tagged = seeded.post(f"/sessions/{sid}/person", json={"name": "Jordan Lee"})
    assert tagged.status_code == 200
    assert tagged.json()["person_id"] == "jordan-lee" and tagged.json()["sessions"] == 1
    again = seeded.post(f"/sessions/{sid}/person", json={"name": "Jordan Lee"})
    assert again.json()["sessions"] == 1
    assert len(seeded.get("/people").json()) == 4
    rows = {r["session_id"]: r for r in seeded.get("/sessions").json()}
    assert rows[sid]["person_id"] == "jordan-lee"


def test_tagging_errors(seeded: TestClient) -> None:
    assert seeded.post("/sessions/missing/person", json={"name": "Alex"}).status_code == 404
    sid = seeded.get("/sessions").json()[0]["session_id"]
    assert seeded.post(f"/sessions/{sid}/person", json={"name": ""}).status_code == 422
    assert seeded.post(f"/sessions/{sid}/person", json={"name": "   "}).status_code == 422
    assert seeded.post(f"/sessions/{sid}/person", json={}).status_code == 422
