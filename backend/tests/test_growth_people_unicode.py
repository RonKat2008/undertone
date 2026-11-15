"""People tagging with names outside ASCII, and client-supplied person ids (found in QA)."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
from pydantic import ValidationError

from backend.db import DB
from backend.growth._people import slugify, tag_session
from backend.growth.routes import TagPerson


@pytest.fixture
def db(tmp_path: Path) -> DB:
    d = DB(tmp_path / "u.db")
    for sid in ("s1", "s2", "s3"):
        d.create_session(sid, "core", "Core", "regular", datetime.now(timezone.utc).isoformat())
    return d


def test_accents_fold_to_plain_letters() -> None:
    assert slugify("Zoë") == "zoe"
    assert slugify("José Núñez") == "jose-nunez"


def test_different_non_latin_names_get_different_ids() -> None:
    ids = {slugify(n) for n in ("東京太郎", "山田花子", "🙂", "Ада")}
    assert len(ids) == 4 and "person" not in ids
    assert slugify("東京太郎") == slugify(" 東京太郎 ")  # stable


def test_names_that_share_only_their_latin_part_stay_apart() -> None:
    assert slugify("Li 李") != slugify("Li 黎")


def test_tagging_two_non_latin_names_makes_two_people(db: DB) -> None:
    a = tag_session(db, "s1", "東京太郎")
    b = tag_session(db, "s2", "🙂")
    assert a.person_id != b.person_id
    assert {p.name for p in db.list_people()} == {"東京太郎", "🙂"}


@pytest.mark.parametrize("pid", ["../../etc", "a/b", "x y", "a" * 81, "<b>"])
def test_odd_person_ids_are_refused(pid: str) -> None:
    with pytest.raises(ValidationError):
        TagPerson(name="Alex", person_id=pid)


def test_slug_person_ids_are_accepted() -> None:
    assert TagPerson(name="Alex", person_id="alex-chen").person_id == "alex-chen"
    assert TagPerson(name="Tokyo", person_id=slugify("東京太郎")).person_id == slugify("東京太郎")
    assert TagPerson(name="Alex", person_id="sample_alex").person_id == "sample_alex"
