"""Weekly report: progress against the wearer's own baseline, as information, never a grade."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from backend.contracts import DebriefNumbers, WeeklyReport
from backend.db import DB
from backend.growth._report import weekly_report, report_for
from backend.growth._store import StoredSession, load_sessions
from backend.growth._writer import SessionSpec, write_session

TODAY = date(2026, 11, 14)
BANNED = ("bad", "failed", "fail", "worse", "poor", "grade")


def nums(talk: float = 0.5, inter: int = 2, q: int = 1, fill: float = 6.0, wpm: float = 150) -> DebriefNumbers:
    return DebriefNumbers(talk_ratio=talk, interruptions=inter, questions=q, fillers_per_min=fill, wpm=wpm)


def add(db: DB, sid: str, days_ago: int, n: DebriefNumbers, hour: int = 10) -> None:
    when = datetime.combine(TODAY - timedelta(days=days_ago), datetime.min.time(), timezone.utc)
    write_session(db, SessionSpec(session_id=sid, started_at=when + timedelta(hours=hour), numbers=n))


def load(tmp_path: Path, rows: list[tuple[str, int, DebriefNumbers]]) -> list[StoredSession]:
    db = DB(tmp_path / "t.db")
    for i, (sid, days_ago, n) in enumerate(rows):
        add(db, sid, days_ago, n, hour=8 + i % 10)
    return load_sessions(db)


def trend(report: WeeklyReport) -> dict[str, tuple[float, float]]:
    return {t.metric: (t.from_, t.to_) for t in report.trend}


def assert_informational(report: WeeklyReport) -> None:
    text = report.biggest_improvement.lower()
    assert text
    assert not any(word in text.split() for word in BANNED)


def test_empty_report() -> None:
    r = weekly_report([], TODAY)
    assert r.week_of == "2026-11-08"
    assert r.trend == []
    assert r.best_session_id is None
    assert r.biggest_improvement == "No conversations this week yet."


def test_sessions_only_before_week_give_empty_trend(tmp_path: Path) -> None:
    sessions = load(tmp_path, [("old", 10, nums())])
    r = weekly_report(sessions, TODAY)
    assert r.trend == [] and r.best_session_id is None
    assert r.biggest_improvement == "No conversations this week yet."


def test_baseline_from_before_the_week(tmp_path: Path) -> None:
    sessions = load(tmp_path, [
        ("b1", 20, nums(fill=7.0)), ("b2", 15, nums(fill=8.0)), ("b3", 9, nums(fill=7.5)),
        ("w1", 3, nums(fill=4.0)), ("w2", 1, nums(fill=4.4)),
    ])
    r = weekly_report(sessions, TODAY)
    t = trend(r)
    assert set(t) == {"talk_ratio", "interruptions", "questions", "fillers_per_min", "wpm"}
    assert t["fillers_per_min"] == (7.5, 4.2)
    assert t["talk_ratio"] == (0.5, 0.5)
    assert r.biggest_improvement == "Fillers fell from 7.5 to 4.2 a minute against your usual."
    assert_informational(r)


def test_trend_serialises_with_from_and_to(tmp_path: Path) -> None:
    sessions = load(tmp_path, [("b1", 10, nums()), ("w1", 1, nums(q=3))])
    dumped = weekly_report(sessions, TODAY).model_dump(mode="json")
    q = next(p for p in dumped["trend"] if p["metric"] == "questions")
    assert q["from"] == 1 and q["to"] == 3


def test_only_in_week_sessions_split_into_halves(tmp_path: Path) -> None:
    sessions = load(tmp_path, [
        ("w1", 6, nums(q=1)), ("w2", 5, nums(q=1)), ("w3", 2, nums(q=3)), ("w4", 0, nums(q=3)),
    ])
    r = weekly_report(sessions, TODAY)
    assert trend(r)["questions"] == (1, 3)
    assert r.biggest_improvement == "You asked 3 questions per conversation, up from 1."
    assert_informational(r)


def test_single_session_week_without_history(tmp_path: Path) -> None:
    sessions = load(tmp_path, [("only", 0, nums(talk=0.62))])
    r = weekly_report(sessions, TODAY)
    assert all(f == t for f, t in trend(r).values())
    assert r.best_session_id == "only"
    assert r.biggest_improvement == "Your numbers held steady against your usual this week."


def test_best_session_is_most_improved(tmp_path: Path) -> None:
    base = nums(talk=0.6, inter=3, q=1, fill=6.0)
    sessions = load(tmp_path, [
        ("b1", 12, base), ("b2", 10, base),
        ("great", 4, nums(talk=0.4, inter=1, q=3, fill=3.0)),
        ("ok", 2, nums(talk=0.5, inter=3, q=1, fill=6.0)),
        ("same", 1, base),
    ])
    assert weekly_report(sessions, TODAY).best_session_id == "great"


def test_best_session_tie_goes_to_newest(tmp_path: Path) -> None:
    base = nums()
    sessions = load(tmp_path, [("b1", 12, base), ("older", 4, nums(q=3)), ("newer", 2, nums(q=3))])
    assert weekly_report(sessions, TODAY).best_session_id == "newer"


def test_talk_share_sentence_uses_percent(tmp_path: Path) -> None:
    sessions = load(tmp_path, [("b1", 12, nums(talk=0.7)), ("w1", 1, nums(talk=0.5))])
    r = weekly_report(sessions, TODAY)
    assert r.biggest_improvement == "You talked 50% of the time, down from 70% against your usual."


def test_nothing_improved_is_neutral(tmp_path: Path) -> None:
    sessions = load(tmp_path, [("b1", 12, nums()), ("w1", 1, nums(talk=0.6, inter=4, fill=8.0))])
    r = weekly_report(sessions, TODAY)
    assert r.biggest_improvement == "Your numbers held steady against your usual this week."
    assert_informational(r)


def test_report_for_db(tmp_path: Path) -> None:
    db = DB(tmp_path / "t.db")
    add(db, "b1", 10, nums(inter=4))
    add(db, "w1", 2, nums(inter=1))
    r = report_for(db, TODAY)
    assert r.week_of == "2026-11-08"
    assert r.best_session_id == "w1"
    assert "Interruptions" in r.biggest_improvement
