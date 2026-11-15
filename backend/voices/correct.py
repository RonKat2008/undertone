"""Correct stored turns' speaker labels from per-word (or per-turn) voice decisions. Pure."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from backend.contracts import TurnFinalEvent
from backend.stt.fillers import find_fillers
from backend.voices.types import Role, TimedWord

_SLACK_S = 0.05
_FLICKER_WORDS = 2
_FLICKER_S = 0.6

Run = tuple[Role, tuple[int, ...]]  # role, word indices


@dataclass(frozen=True)
class Correction:
    turns: tuple[TurnFinalEvent, ...]
    relabelled: int
    split: int
    unchanged: int


def _assign_words(order: Sequence[TurnFinalEvent], words: Sequence[TimedWord]) -> list[list[int]]:
    """Word indices per turn (turns in `order`); a word goes to the first turn holding its midpoint."""
    owned: list[list[int]] = [[] for _ in order]
    for i, w in enumerate(words):
        mid = (w.start + w.end) / 2.0
        for k, t in enumerate(order):
            if t.start - _SLACK_S <= mid <= t.end + _SLACK_S:
                owned[k].append(i)
                break
    return owned


def _fill_unknown(roles: list[Role | None]) -> list[Role]:
    """Unknown roles inherit the previous known one (or the next, at the start)."""
    first = next(r for r in roles if r is not None)
    out: list[Role] = []
    for r in roles:
        out.append(r if r is not None else (out[-1] if out else first))
    return out


def _runs(idx: list[int], roles: list[Role]) -> list[Run]:
    runs: list[Run] = []
    for i, r in zip(idx, roles):
        if runs and runs[-1][0] == r:
            runs[-1] = (r, runs[-1][1] + (i,))
        else:
            runs.append((r, (i,)))
    return runs


def _coalesce(runs: list[Run]) -> list[Run]:
    out: list[Run] = []
    for r, ws in runs:
        if out and out[-1][0] == r:
            out[-1] = (r, out[-1][1] + ws)
        else:
            out.append((r, ws))
    return out


def _is_flicker(run: Run, words: Sequence[TimedWord]) -> bool:
    ws = run[1]
    return len(ws) < _FLICKER_WORDS and words[ws[-1]].end - words[ws[0]].start < _FLICKER_S


def _merge_flicker(runs: list[Run], words: Sequence[TimedWord]) -> list[Run]:
    """Fold too-short runs into a neighbour (the previous one, else the next) until stable."""
    current = runs
    while len(current) > 1:
        k = next((i for i, run in enumerate(current) if _is_flicker(run, words)), None)
        if k is None:
            break
        role = current[k - 1][0] if k > 0 else current[k + 1][0]
        current = _coalesce([(role, ws) if i == k else (r, ws)
                             for i, (r, ws) in enumerate(current)])
    return current


def _piece(turn: TurnFinalEvent, k: int, run: Run, words: Sequence[TimedWord],
           filler_words: Sequence[str]) -> TurnFinalEvent:
    texts = [words[i].text for i in run[1]]
    start, end = words[run[1][0]].start, words[run[1][-1]].end
    duration = end - start
    wpm = round(len(texts) / (duration / 60.0), 1) if duration > 0 else 0.0
    return turn.model_copy(update={
        "turn_id": f"{turn.turn_id}.{k}", "speaker": run[0], "text": " ".join(texts),
        "start": start, "end": end, "wpm": wpm,
        "fillers": find_fillers(texts, filler_words),
    })


def _relabel(turn: TurnFinalEvent, role: Role | None) -> tuple[list[TurnFinalEvent], str]:
    if role is None or role == turn.speaker:
        return [turn], "unchanged"
    return [turn.model_copy(update={"speaker": role})], "relabelled"


def _correct_one(turn: TurnFinalEvent, idx: list[int], words: Sequence[TimedWord],
                 word_roles: Sequence[Role | None], turn_roles: Mapping[str, Role],
                 filler_words: Sequence[str]) -> tuple[list[TurnFinalEvent], str]:
    roles = [word_roles[i] for i in idx]
    if all(r is None for r in roles):
        return _relabel(turn, turn_roles.get(turn.turn_id))
    runs = _merge_flicker(_runs(idx, _fill_unknown(roles)), words)
    if len(runs) == 1:
        return _relabel(turn, runs[0][0])
    pieces = [_piece(turn, k, run, words, filler_words) for k, run in enumerate(runs, 1)]
    return pieces, "split"


def correct_turns(turns: Sequence[TurnFinalEvent], words: Sequence[TimedWord],
                  word_roles: Sequence[Role | None], turn_roles: Mapping[str, Role],
                  filler_words: Sequence[str]) -> Correction:
    """Relabel or split turns by the voices actually heard in them."""
    if len(word_roles) != len(words):
        raise ValueError("word_roles must have one entry per word")
    order = sorted(turns, key=lambda t: (t.start, t.end))
    owned = _assign_words(order, words)
    out: list[TurnFinalEvent] = []
    counts = {"relabelled": 0, "split": 0, "unchanged": 0}
    for turn, idx in zip(order, owned):
        new, kind = _correct_one(turn, idx, words, word_roles, turn_roles, filler_words)
        out.extend(new)
        counts[kind] += 1
    out.sort(key=lambda t: (t.start, t.end))
    return Correction(turns=tuple(out), **counts)
