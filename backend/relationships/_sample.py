"""The speech a relationship is inferred from: a recent, bounded sample of kept conversations.

Kept means what growth and the graph use (finished, `kept` NULL or 1), and never a session whose
verdict is 'sensitive' or 'noise' (checked again here so a user-kept noise row still stays out).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from backend.contracts import TurnFinalEvent
from backend.db import DB, KEPT_SQL

MAX_SESSIONS = 5  # most recent kept conversations sampled
MAX_TURNS = 80  # most recent turns across them
MAX_TURN_CHARS = 300
MAX_INPUT_CHARS = 6000
MIN_TURNS = 6
MIN_WORDS = 80  # below this, never guess a label
MIN_SIDE_WORDS = 20  # both people must actually speak

_KEPT = (f"ended_at IS NOT NULL AND {KEPT_SQL} "
         "AND (kept_reason IS NULL OR kept_reason NOT IN ('sensitive', 'noise'))")


@dataclass(frozen=True)
class Sample:
    person_id: str
    session_ids: tuple[str, ...]  # every kept session with this person, newest first
    conversations: tuple[tuple[TurnFinalEvent, ...], ...]  # sampled, oldest conversation first

    def words(self, speaker: str | None = None) -> int:
        return sum(len(t.text.split()) for conv in self.conversations for t in conv
                   if speaker is None or t.speaker == speaker)

    @property
    def turn_count(self) -> int:
        return sum(len(conv) for conv in self.conversations)


def kept_session_ids(db: DB, person_id: str) -> list[str]:
    rows = db.query(f"SELECT session_id FROM sessions WHERE person_id = ? AND {_KEPT} "
                    "ORDER BY started_at DESC, session_id DESC", (person_id,))
    return [r["session_id"] for r in rows]


def sample_from(person_id: str, conversations: Sequence[Sequence[TurnFinalEvent]],
                session_ids: Sequence[str] = ()) -> Sample:
    """Bound conversations given oldest first: keep the newest MAX_SESSIONS and MAX_TURNS turns."""
    kept: list[tuple[TurnFinalEvent, ...]] = []
    budget = MAX_TURNS
    for conv in reversed(list(conversations)[-MAX_SESSIONS:]):
        turns = tuple(t for t in conv if t.text.strip())
        if budget <= 0:
            break
        if turns:
            kept.append(turns[-budget:])
            budget -= len(kept[-1])
    return Sample(person_id=person_id, session_ids=tuple(session_ids), conversations=tuple(reversed(kept)))


def load_sample(db: DB, person_id: str) -> Sample:
    sids = kept_session_ids(db, person_id)
    convs = [db.load_turns(sid) for sid in reversed(sids[:MAX_SESSIONS])]
    return sample_from(person_id, convs, sids)


def _line(t: TurnFinalEvent) -> str:
    text = " ".join(t.text.split())[:MAX_TURN_CHARS]
    return f"{'ME' if t.speaker == 'me' else 'OTHER'}: {text}"


def format_sample(sample: Sample, max_chars: int = MAX_INPUT_CHARS) -> str:
    """ME/OTHER lines, conversations separated, the newest speech kept when the cap cuts."""
    blocks = []
    for i, conv in enumerate(sample.conversations, 1):
        blocks.append(f"[conversation {i}]\n" + "\n".join(_line(t) for t in conv))
    text = "\n\n".join(blocks) or "(no speech)"
    if len(text) <= max_chars:
        return text
    return "[... earlier speech cut ...]\n" + text[-max_chars:].split("\n", 1)[-1]


def thin_reason(sample: Sample) -> str | None:
    """Why there is not enough speech to label yet, or None when there is."""
    words = sample.words()
    if words < MIN_WORDS:
        return f"only {words} words so far"
    if sample.turn_count < MIN_TURNS:
        return f"only {sample.turn_count} lines so far"
    if min(sample.words("me"), sample.words("other")) < MIN_SIDE_WORDS:
        return "mostly one side speaking"
    return None
