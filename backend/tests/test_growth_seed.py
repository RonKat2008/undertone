"""Tests for backend/growth/_sample.py and scripts/seed_sample.py (demo sample data)."""

from __future__ import annotations

import os
import subprocess
import sys
from collections.abc import Iterator
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from statistics import mean

import pytest

from backend.contracts import DebriefNumbers
from backend.db import DB

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "seed_sample.py"
TODAY = date(2026, 11, 14)

from backend.growth._sample import SAMPLE_PEOPLE, SAMPLE_PREFIX, sample_specs, seed  # noqa: E402
from backend.growth._store import load_sessions  # noqa: E402
from backend.growth._writer import SessionSpec, write_session  # noqa: E402


@pytest.fixture
def db(tmp_path: Path) -> Iterator[DB]:
    d = DB(tmp_path / "seed.db")
    yield d
    d.close()


def _real_session(db: DB) -> None:
    write_session(db, SessionSpec(
        session_id="real-1", started_at=datetime(2026, 11, 14, 9, tzinfo=timezone.utc),
        numbers=DebriefNumbers(talk_ratio=0.5, interruptions=1, questions=2, fillers_per_min=3.0, wpm=150),
        wearer_texts=("Hello there.",), other_texts=("Hi.",)))


def _session_count(db: DB) -> int:
    return db.query("SELECT COUNT(*) AS n FROM sessions")[0]["n"]


# ---------- sample_specs ----------
def test_specs_cover_last_ten_days_with_prefixed_ids() -> None:
    specs = sample_specs(TODAY)
    assert 7 <= len(specs) <= 9
    for s in specs:
        assert s.session_id.startswith(SAMPLE_PREFIX)
        day = s.started_at.astimezone(timezone.utc).date()
        assert TODAY - timedelta(days=10) <= day < TODAY  # nothing today, so the live demo is first
        assert 5 * 60 <= s.duration_s <= 25 * 60
        assert 5 <= len(s.wearer_texts) <= 10
        assert s.other_texts and s.nudges and s.notes
        assert s.if_then.startswith(("When", "If"))
        assert -22 <= s.volume_db <= -18
    assert TODAY - timedelta(days=1) in {s.started_at.date() for s in specs}
    assert len({s.session_id for s in specs}) == len(specs)


def test_specs_use_three_people_and_both_coaches() -> None:
    specs = sample_specs(TODAY)
    assert len(SAMPLE_PEOPLE) == 3
    ids = {p.person_id for p in SAMPLE_PEOPLE}
    assert {s.person_id for s in specs} == ids
    assert all(not pid.startswith(SAMPLE_PREFIX) for pid in ids)
    assert {s.coach_id for s in specs} == {"listener", "interview"}


def test_trend_is_improving() -> None:
    specs = sorted(sample_specs(TODAY), key=lambda s: s.started_at)
    first, last = [s.numbers for s in specs[:3]], [s.numbers for s in specs[-3:]]
    assert mean(n.fillers_per_min for n in last) < mean(n.fillers_per_min for n in first)
    assert mean(n.interruptions for n in last) < mean(n.interruptions for n in first)
    assert mean(n.questions for n in last) > mean(n.questions for n in first)
    assert mean(n.talk_ratio for n in last) < mean(n.talk_ratio for n in first)


def test_person_patterns() -> None:
    specs = sample_specs(TODAY)
    alex = [s.numbers.interruptions for s in specs if s.person_id == "alex"]
    rest = [s.numbers.interruptions for s in specs if s.person_id != "alex"]
    assert mean(alex) >= 2 * mean(rest)
    sam = [s.numbers.talk_ratio for s in specs if s.person_id == "sam"]
    others = [s.numbers.talk_ratio for s in specs if s.person_id != "sam"]
    assert mean(sam) > mean(others)


def test_wearer_text_has_crutch_words_and_loud_nudges_match_numbers() -> None:
    for s in sample_specs(TODAY):
        text = " ".join(s.wearer_texts).lower()
        assert any(w in text for w in ("um", "you know", "basically", "i mean", ", like,"))
        assert text.count("?") >= s.numbers.questions
        interrupts = [loud for r, loud in s.nudges if r == "interrupt"]
        assert len(interrupts) == s.numbers.interruptions  # every interruption is marked
        if s.coach_id == "listener":  # interrupting is the listener focus habit: buzz up to budget
            assert sum(interrupts) == min(s.numbers.interruptions, 5)
        else:
            assert not any(interrupts) and any(r == "hedging" and loud for r, loud in s.nudges)
    all_text = " ".join(t for s in sample_specs(TODAY) for t in s.wearer_texts)
    assert "I like" in all_text or "looks like" in all_text


def test_specs_are_deterministic() -> None:
    assert sample_specs(TODAY) == sample_specs(TODAY)


# ---------- seed ----------
def test_seed_round_trips_through_store(db: DB) -> None:
    n = seed(db, TODAY)
    stored = load_sessions(db)
    assert n == len(stored) == len(sample_specs(TODAY))
    assert {s.person_id for s in stored} == {p.person_id for p in SAMPLE_PEOPLE}
    for s in stored:
        assert s.wearer_turns
        assert s.nudges
        assert s.debrief is not None and s.debrief.notes
        assert any(note.startswith("Follow up:") for note in s.debrief.notes)
    assert {p.name for p in db.list_people()} == {p.name for p in SAMPLE_PEOPLE}


def test_seed_refuses_non_empty_db(db: DB) -> None:
    _real_session(db)
    with pytest.raises(RuntimeError, match="already has"):
        seed(db, TODAY)
    assert _session_count(db) == 1


def test_seed_refuses_second_run_without_force(db: DB) -> None:
    seed(db, TODAY)
    with pytest.raises(RuntimeError):
        seed(db, TODAY)


def test_force_replaces_sample_rows_and_keeps_real_session(db: DB) -> None:
    seed(db, TODAY)
    _real_session(db)
    first = _session_count(db)
    n = seed(db, TODAY + timedelta(days=1), force=True)
    assert _session_count(db) == first == n + 1
    assert db.get_session("real-1") is not None
    assert db.load_turns("real-1")
    dup = db.query("SELECT COUNT(*) AS n FROM nudges WHERE session_id LIKE 'sample%'")[0]["n"]
    assert dup == sum(len(s.nudges) for s in sample_specs(TODAY + timedelta(days=1)))


def test_force_does_not_touch_lookalike_ids(db: DB) -> None:
    db.create_session("samplexyz", "listener", "Listener", "regular", "2026-11-01T10:00:00+00:00")
    seed(db, TODAY, force=True)
    assert db.get_session("samplexyz") is not None


# ---------- script ----------
def _run_script(*args: str) -> subprocess.CompletedProcess[str]:
    cmd = [sys.executable, str(SCRIPT), *args]
    return subprocess.run(cmd, cwd=REPO_ROOT, capture_output=True, text=True, timeout=60,
                          env=_clean_env())


def _clean_env() -> dict[str, str]:
    """A bare environment, but Windows needs SYSTEMROOT (and friends) or asyncio fails to
    import in the child with WinError 10106."""
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin") if os.name == "nt" else "/usr/bin:/bin",
           "HOME": str(Path.home())}
    for k in ("SYSTEMROOT", "SystemRoot", "WINDIR", "TEMP", "TMP", "USERPROFILE"):
        if k in os.environ:
            env[k] = os.environ[k]
    return env


def test_script_seeds_then_refuses(tmp_path: Path) -> None:
    target = tmp_path / "demo.db"
    ok = _run_script(str(target), "--today", "2026-11-14")
    assert ok.returncode == 0, ok.stderr
    assert "Seeded" in ok.stdout and "sample_" in ok.stdout
    again = _run_script(str(target))
    assert again.returncode == 2
    assert "--force" in again.stderr
    forced = _run_script(str(target), "--force")
    assert forced.returncode == 0, forced.stderr


def test_script_rejects_bad_date(tmp_path: Path) -> None:
    bad = _run_script(str(tmp_path / "x.db"), "--today", "14/11/2026")
    assert bad.returncode == 2
