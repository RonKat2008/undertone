"""People cards (plan.md 4.9): the wearer's own behaviour with one person against the wearer's
own average across all sessions. Never compares the wearer with other users, and never
names other people. Describes behaviour, never the person.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from statistics import mean

from backend.contracts import Person
from backend.db import DB
from backend.growth._store import StoredSession, load_sessions

MAX_NAME_LEN = 80
MAX_LINE_LEN = 140
CLEAR_DIFFERENCE = 0.15  # relative gap below this reads as "matches your usual"
METRICS: tuple[str, ...] = ("interruptions", "questions", "talk_ratio", "fillers_per_min", "wpm")
FOLLOW_UP_STARTS: tuple[str, ...] = (
    "ask", "follow up", "follow-up", "send", "check", "remember", "share", "call", "email", "mention",
    "thank", "invite", "book", "introduce", "find out", "next time",
)


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:64].strip("-") or "person"


def _fmt(value: float) -> str:
    return f"{value:g}" if value == int(value) else f"{value:.1f}".rstrip("0").rstrip(".")


def _ratio(value: float) -> str:
    return "twice" if round(value, 1) == 2.0 else f"{_fmt(round(value, 1))}x"


def _first_name(name: str) -> str:
    parts = name.split()
    return parts[0] if parts else name


def _avg(sessions: Sequence[StoredSession], metric: str) -> float:
    return mean(float(getattr(s.numbers, metric)) for s in sessions)


def _phrase(metric: str, name: str, mine: float, usual: float) -> str:
    up = mine > usual
    r = mine / usual if usual > 0 else 0.0
    if metric == "interruptions":
        if up and r >= 1.5:
            return f"You interrupt {name} {_ratio(r)} more than you usually do."
        word = "more" if up else "less"
        return f"You interrupt {name} {word} than usual: {_fmt(round(mine, 1))} a conversation against {_fmt(round(usual, 1))}."
    if metric == "questions":
        if up and r >= 1.5:
            return f"You ask {name} {_ratio(r)} as many questions as usual."
        word = "more" if up else "fewer"
        return f"You ask {name} {word} questions than usual: {_fmt(round(mine, 1))} against {_fmt(round(usual, 1))}."
    if metric == "talk_ratio":
        return f"You talk {mine:.0%} of the time with {name}, against {usual:.0%} usually."
    if metric == "fillers_per_min":
        return f"You use {_fmt(round(mine, 1))} fillers a minute with {name}, against {_fmt(round(usual, 1))} usually."
    return f"You speak at {round(mine):g} wpm with {name}, against {round(usual):g} usually."


def _pattern(name: str, theirs: Sequence[StoredSession], everyone: Sequence[StoredSession]) -> str:
    if len(everyone) == 1:
        return f"One conversation so far; you talked {theirs[0].numbers.talk_ratio:.0%} of the time."
    gaps: list[tuple[float, str, float, float]] = []
    for metric in METRICS:
        mine, usual = _avg(theirs, metric), _avg(everyone, metric)
        if usual > 0:
            gaps.append((abs(mine - usual) / usual, metric, mine, usual))
    best = max(gaps, default=None)
    if best is None or best[0] < CLEAR_DIFFERENCE:
        return f"With {_first_name(name)} your numbers match your usual."
    return _phrase(best[1], _first_name(name), best[2], best[3])


def _reads_like_follow_up(text: str) -> bool:
    low = text.strip().lower()
    return low.startswith(FOLLOW_UP_STARTS) or "follow up" in low


def _follow_up(session: StoredSession) -> str:
    d = session.debrief
    if d is None:
        return ""
    for bm in d.bookmarks:
        if bm.follow_up and bm.follow_up.strip():
            return bm.follow_up.strip()
    note = next((n.strip() for n in d.notes if _reads_like_follow_up(n)), "")
    return note or d.if_then.strip()


def _clip(head: str, tail: str) -> str:
    if not tail:
        return head
    line = f"{head} {tail}"
    if len(line) <= MAX_LINE_LEN:
        return line
    room = MAX_LINE_LEN - len(head) - 2
    cut = tail[:room].rsplit(" ", 1)[0].rstrip(",;:. ")
    return f"{head} {cut}…" if cut else head


def _brief(last: StoredSession) -> str:
    return _clip(f"Last time you talked {last.numbers.talk_ratio:.0%}.", _follow_up(last))


def _card(person: Person, sessions: Sequence[StoredSession]) -> Person:
    theirs = sorted((s for s in sessions if s.person_id == person.person_id),
                    key=lambda s: s.started_at, reverse=True)
    if not theirs:
        return person.model_copy(update={"sessions": 0, "pattern": "", "brief": ""})
    return person.model_copy(update={
        "sessions": len(theirs),
        "pattern": _pattern(person.name, theirs, sessions),
        "brief": _brief(theirs[0]),
    })


def _last_met(person_id: str, sessions: Sequence[StoredSession]) -> str:
    return max((s.started_at for s in sessions if s.person_id == person_id), default="")


def person_cards(sessions: Sequence[StoredSession], people: Sequence[Person]) -> list[Person]:
    cards = [_card(p, sessions) for p in people]
    by_name = sorted(cards, key=lambda c: c.name.lower())
    return sorted(by_name, key=lambda c: _last_met(c.person_id, sessions), reverse=True)


def people_for(db: DB) -> list[Person]:
    return person_cards(load_sessions(db), db.list_people())


def tag_session(db: DB, session_id: str, name: str, person_id: str | None = None) -> Person:
    """Tag a session with a person, then recompute and persist every card."""
    clean = name.strip()
    if not clean:
        raise ValueError("name must not be blank")
    if len(clean) > MAX_NAME_LEN:
        raise ValueError(f"name must be at most {MAX_NAME_LEN} characters")
    if db.get_session(session_id) is None:
        raise LookupError(f"session {session_id} not found")
    pid = (person_id or "").strip() or slugify(clean)
    stored = db.list_people()
    people = stored if any(p.person_id == pid for p in stored) else [*stored, Person(person_id=pid, name=clean)]
    db.set_session_person(session_id, pid)
    cards = person_cards(load_sessions(db), people)
    for c in cards:
        db.save_person(c)
    return next(c for c in cards if c.person_id == pid)
