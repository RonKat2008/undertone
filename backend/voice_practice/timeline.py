"""What happened when, on one clock, and how it splits into question -> answer pairs.

The clock is "stream time": seconds of microphone audio received from the browser. The word
stream's timestamps run on the same clock (it is fed the same bytes), and every voice agent
event is stamped with the stream time at which it arrived.

A coach turn is everything the coach says between two of the wearer's answers. Answer k is what
the wearer said after coach turn k began and before coach turn k+1 began. Words heard while the
coach was still playing are left out (that is the speaker leaking into the mic), unless the
wearer started speaking first (barge-in).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable

from backend.voice_practice.measure import AnswerRecord, TimedWord
from backend.voice_practice.prompt import CLOSING_RE, FIRST_MARK

SPEECH_LEAD_S = 1.5  # the agent reports speech starts up to this late


@dataclass
class CoachTurn:
    start: float
    seq: int  # event order: several events can share one stream time
    texts: list[str] = field(default_factory=list)
    done_at: float | None = None  # the browser finished playing this turn's audio


@dataclass
class Timeline:
    coach: list[CoachTurn] = field(default_factory=list)
    user_starts: list[float] = field(default_factory=list)
    user_texts: list[tuple[int, str]] = field(default_factory=list)  # (event order, text)
    words: list[TimedWord] = field(default_factory=list)
    _seq: int = 0

    def _next(self) -> int:
        self._seq += 1
        return self._seq

    def _answered_since(self, turn: CoachTurn) -> bool:
        return any(seq > turn.seq for seq, _ in self.user_texts)

    def _coach_turn(self, at: float) -> CoachTurn:
        if not self.coach or self._answered_since(self.coach[-1]):
            self.coach.append(CoachTurn(start=at, seq=self._next()))
        return self.coach[-1]

    def coach_started(self, at: float) -> None:
        self._coach_turn(at)

    def coach_text(self, at: float, text: str) -> None:
        if text.strip():
            self._coach_turn(at).texts.append(text.strip())

    def user_started(self, at: float) -> None:
        self.user_starts.append(at)

    def user_text(self, at: float, text: str) -> None:
        if text.strip():
            self.user_texts.append((self._next(), text.strip()))

    def playback_done(self, at: float) -> None:
        if self.coach and self.coach[-1].done_at is None:
            self.coach[-1].done_at = at

    def add_words(self, words: Iterable[TimedWord]) -> None:
        self.words.extend(words)

    @property
    def questions(self) -> int:
        return len(self.coach)

    @property
    def answers(self) -> int:
        return sum(1 for turn in self.coach if self._answered_since(turn))

    def _word_floor(self, turn: CoachTurn, lo: float, hi: float) -> float:
        started = [s for s in self.user_starts if lo <= s < hi]
        if turn.done_at is not None and not (started and started[0] < turn.done_at):
            return turn.done_at
        return max(lo, started[0] - SPEECH_LEAD_S) if started else lo

    def records(self) -> list[AnswerRecord]:
        out: list[AnswerRecord] = []
        for k, turn in enumerate(self.coach):
            last = k + 1 == len(self.coach)
            hi = float("inf") if last else self.coach[k + 1].start
            hi_seq = self._seq + 1 if last else self.coach[k + 1].seq
            texts = [text for seq, text in self.user_texts if turn.seq < seq < hi_seq]
            floor = self._word_floor(turn, turn.start, hi)
            words = tuple(sorted((w for w in self.words if floor <= w.start < hi), key=lambda w: w.start))
            if (not texts and not words) or CLOSING_RE.search(" ".join(turn.texts)):
                continue  # nothing said, or the coach's goodbye (a "thanks" after it is no answer)
            out.append(AnswerRecord(index=len(out) + 1, question=_question(turn.texts), agent_text=" ".join(texts),
                                    words=words, coach_done_at=turn.done_at))
        return out


def _question(texts: list[str]) -> str:
    """What the coach asked: the greeting's opener ("Hi, I'm your coach ... First question.") left out."""
    said = " ".join(texts)
    _, mark, after = said.partition(FIRST_MARK)
    return after.strip() if mark and after.strip() else said
