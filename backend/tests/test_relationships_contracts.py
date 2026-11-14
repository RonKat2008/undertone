"""Relationship REST types: field and literal parity with contracts/events.ts, and validation."""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from pydantic import BaseModel, ValidationError

from backend import contracts as c

EVENTS_TS = Path(__file__).resolve().parents[2] / "contracts" / "events.ts"


def _fields(name: str) -> set[str]:
    match = re.search(r"export interface " + name + r" \{(.*?)\n\}", EVENTS_TS.read_text(), re.S)
    assert match, f"{name} missing from events.ts"
    return set(re.findall(r"^\s+(\w+):", match.group(1), re.M))


def _union(name: str) -> set[str]:
    match = re.search(r"export type " + name + r" = ([^;]+);", EVENTS_TS.read_text())
    assert match, f"{name} missing from events.ts"
    return set(re.findall(r"'([a-z_]+)'", match.group(1)))


@pytest.mark.parametrize("name", ["Relationship", "PersonRelationship", "RelationshipUpdate"])
def test_fields_match_ts(name: str) -> None:
    model: type[BaseModel] = getattr(c, name)
    assert set(model.model_fields) == _fields(name)


@pytest.mark.parametrize("name", ["RelationshipKind", "RelationshipFormality", "RelationshipPower",
                                  "RelationshipSource"])
def test_literals_match_ts(name: str) -> None:
    assert set(getattr(c, name).__args__) == _union(name)


def test_kind_set_is_the_agreed_one() -> None:
    assert set(c.RelationshipKind.__args__) == {  # type: ignore[attr-defined]
        "friend", "partner", "family", "boss", "report", "coworker", "client", "teacher", "student",
        "service", "acquaintance", "stranger", "unknown"}


@pytest.mark.parametrize("bad", [{"confidence": 1.5}, {"warmth": -0.1}, {"kind": "enemy"},
                                 {"evidence": ["a", "b", "c", "d"]}, {"source": "gpt"}])
def test_validation(bad: dict) -> None:
    base = {"person_id": "p", "kind": "friend", "confidence": 0.5, "source": "rules"}
    c.Relationship.model_validate(base)
    with pytest.raises(ValidationError):
        c.Relationship.model_validate({**base, **bad})
