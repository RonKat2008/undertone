"""Relationship routes. Reads are cheap; inference runs in the background or on an explicit refresh.

Paths sit beside growth's `GET /people` and `POST /sessions/{id}/person` without overlapping them.
"""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Path

from backend.contracts import PersonRelationship, Relationship, RelationshipUpdate
from backend.db import DB
from backend.deps import get_app_state
from backend.relationships._refresh import known_people, refresh_person, refresh_stale, stale_people
from backend.relationships._sample import kept_session_ids
from backend.relationships._store import effective, load_row, load_rows, placeholder, save_user_kind
from backend.state import AppState

router = APIRouter(tags=["relationships"])

PersonId = Path(min_length=1, max_length=80)


def _require(db: DB, person_id: str) -> None:
    if person_id not in known_people(db):
        raise HTTPException(404, f"person {person_id} not found")


def _current(db: DB, person_id: str) -> Relationship:
    return effective(load_row(db, person_id)) or placeholder(person_id)


@router.get("/relationships", response_model=list[PersonRelationship])
def list_relationships(background: BackgroundTasks, st: AppState = Depends(get_app_state)) -> list[PersonRelationship]:
    """Every known person with their relationship (a placeholder until analysed), by name."""
    rows = load_rows(st.db)
    people = sorted(known_people(st.db).items(), key=lambda kv: (kv[1].lower(), kv[0]))
    if stale_people(st.db):
        background.add_task(refresh_stale, st.db)
    return [PersonRelationship(person_id=pid, name=name, sessions=len(kept_session_ids(st.db, pid)),
                               relationship=effective(rows.get(pid)) or placeholder(pid))
            for pid, name in people]


@router.get("/people/{person_id}/relationship", response_model=Relationship)
def get_relationship(person_id: str = PersonId, st: AppState = Depends(get_app_state)) -> Relationship:
    _require(st.db, person_id)
    return _current(st.db, person_id)


@router.post("/people/{person_id}/relationship/refresh", response_model=Relationship)
async def refresh_relationship(person_id: str = PersonId, st: AppState = Depends(get_app_state)) -> Relationship:
    """Re-infer now (one Decisions call at most). A user label is returned unchanged."""
    _require(st.db, person_id)
    result = await refresh_person(st.db, person_id, force=True)
    if result is None:
        raise HTTPException(503, "relationship refresh failed; see the server log")
    return result


@router.put("/people/{person_id}/relationship", response_model=Relationship)
def set_relationship(body: RelationshipUpdate, person_id: str = PersonId,
                     st: AppState = Depends(get_app_state)) -> Relationship:
    """The wearer's own label: source 'user', confidence 1, never overwritten by inference."""
    _require(st.db, person_id)
    save_user_kind(st.db, person_id, body.kind)
    return _current(st.db, person_id)


@router.delete("/people/{person_id}/relationship", response_model=Relationship)
def clear_relationship(background: BackgroundTasks, person_id: str = PersonId,
                       st: AppState = Depends(get_app_state)) -> Relationship:
    """Clear the wearer's label; the inferred result shows again and a refresh is scheduled."""
    _require(st.db, person_id)
    save_user_kind(st.db, person_id, None)
    background.add_task(refresh_person, st.db, person_id)
    return _current(st.db, person_id)
