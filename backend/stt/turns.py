"""Turns from Deepgram words. Pure logic, no network: unit tested in test_turns.py.

Phase 1 (Nova-only): a turn is a run of final Nova words from one speaker label. It closes
when the label changes, when there is a gap of more than `gap_s` between words, or when no
new words arrive for `flush_s` of audio.

Phase 2 (Flux): a turn is a Flux end-of-turn window. Its speaker is the majority label of
the Nova words inside the window; its text is those words. If the Flux and Nova clocks do
not line up within ~300 ms, `FluxTurnAssembler.misaligned` turns True and the caller falls
back to Nova-only (plan.md 3.2).

All times are seconds since session start (the Pipecat worker starts with the session).
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Callable, Dict, Iterable, List, Optional, Sequence, Tuple

from .fillers import DEFAULT_FILLERS, find_fillers


@dataclass(frozen=True)
class Word:
    text: str           # punctuated_word when Deepgram gives it (keeps "?" for question detection)
    start: float
    end: float
    label: int          # Deepgram speaker number (0, 1, ...)


# ---------- reading Deepgram results (objects or dicts) ----------

def _get(o, k, default=None):
    if o is None:
        return default
    if isinstance(o, dict):
        return o.get(k, default)
    return getattr(o, k, default)


def words_from_result(result) -> Tuple[float, List[Word]]:
    """(result.start, words) from a Deepgram live result, whatever its Python shape."""
    start = float(_get(result, "start", 0.0) or 0.0)
    ch = _get(result, "channel")
    alts = _get(ch, "alternatives") or []
    if not alts:
        return start, []
    out = []
    for w in _get(alts[0], "words") or []:
        text = _get(w, "punctuated_word") or _get(w, "word") or ""
        spk = _get(w, "speaker")
        out.append(Word(text, float(_get(w, "start", 0.0)), float(_get(w, "end", 0.0)),
                        int(spk) if spk is not None else 0))
    return start, out


class WordDeduper:
    """Nova sends one TranscriptionFrame per speaker run, and runs from one result share the
    same result object: the same words can arrive more than once. Key: (result.start, word.start)."""

    def __init__(self) -> None:
        self._seen: set = set()

    def new(self, result_start: float, words: Iterable[Word]) -> List[Word]:
        out = []
        for w in words:
            k = (round(result_start, 3), round(w.start, 3))
            if k not in self._seen:
                self._seen.add(k)
                out.append(w)
        return sorted(out, key=lambda w: w.start)


# ---------- who is the wearer ----------

class SpeakerMapper:
    """The wearer speaks first after the double-tap, so the first label heard is `me`.
    Cross-checked once with loudness (the mic is on the wearer's wrist), and the dashboard's
    "swap speakers" button can flip it any time."""

    def __init__(self, single_speaker: bool = False) -> None:
        self.me_label: Optional[int] = None
        self.single_speaker = single_speaker  # demo mode: everything is the wearer
        self.swapped_by_loudness = False
        self._db: Dict[int, List[float]] = {}
        self._other_label: Optional[int] = None

    def speaker(self, label: int) -> str:
        if self.single_speaker:
            return "me"
        if self.me_label is None:
            self.me_label = label
        if label != self.me_label and self._other_label is None:
            self._other_label = label
        return "me" if label == self.me_label else "other"

    @property
    def settled(self) -> bool:
        """True once `me` is no longer a guess: demo mode, or the loudness check has decided."""
        return self.single_speaker or self.swapped_by_loudness

    def swap(self) -> None:
        """Manual override. With two labels known, they trade places; with one, the next new
        label becomes the wearer."""
        if self._other_label is not None and self.me_label is not None:
            self.me_label, self._other_label = self._other_label, self.me_label
        else:
            self._other_label, self.me_label = self.me_label, None

    def note_loudness(self, label: int, db: Optional[float]) -> None:
        if db is not None:
            self._db.setdefault(label, []).append(db)

    def maybe_swap_by_loudness(self, min_words: int = 4, confirm_words: int = 10, margin_db: float = 6.0) -> bool:
        """Early, at most one swap: if the label we call `other` is clearly louder than `me`, swap.

        Checked as soon as both labels have `min_words` words, so the swap lands before the
        second speaker's first turn is emitted (with 10 words it came a turn or two late, and
        those turns went out with the wrong speaker). A "no swap" verdict stays open until
        both have `confirm_words`; after that, or after a swap, it never changes again."""
        if self.swapped_by_loudness or self.single_speaker or self.me_label is None or self._other_label is None:
            return False
        me, ot = self._db.get(self.me_label, []), self._db.get(self._other_label, [])
        if len(me) < min_words or len(ot) < min_words:
            return False
        if statistics.median(ot) - statistics.median(me) >= margin_db:
            self.swap()
            self.swapped_by_loudness = True
            return True
        if len(me) >= confirm_words and len(ot) >= confirm_words:
            self.swapped_by_loudness = True  # checked; do not keep second-guessing
        return False


# ---------- turn events ----------

def make_turn_event(n: int, speaker: str, words: Sequence[Word], filler_list: Iterable[str]) -> dict:
    start, end = words[0].start, words[-1].end
    dur = max(end - start, 0.5)
    return {
        "type": "turn.final",
        "turn_id": "t%d" % n,
        "speaker": speaker,
        "text": " ".join(w.text for w in words).strip(),
        "start": round(start, 3),
        "end": round(end, 3),
        "wpm": round(len(words) / dur * 60, 1),
        "fillers": find_fillers([w.text for w in words], filler_list),
    }


class NovaTurnAssembler:
    """Turns from final Nova words.

    Deepgram finalises a stretch of speech only at its next endpoint, often 1-3 s after the
    words were spoken, while interim results keep arriving as people talk. So "no final
    word for flush_s" does not mean "quiet": the speaker may be mid-sentence with the final
    still on its way. `heard(end)` takes the end of the latest interim word; while interim
    words lie beyond the last final word (a final is pending), the turn stays open, up to
    `pending_max_s` past the last interim in case that final never comes.

    gap_s is 2.0 s and flush_s 3.0 s (were 1.2 / 1.5): a thinking pause of 1.5 s
    ("Um, ... got it") is still the same turn, and after such a pause the first interim of
    the next words arrives ~0.7-1 s later, so the flush has to wait gap_s plus that. A turn
    followed by the other person still closes as soon as their first final word arrives
    (label change); flush_s only sets the latency of a turn followed by silence.
    """

    def __init__(self, mapper: SpeakerMapper, on_turn: Callable[[dict], None],
                 filler_list: Iterable[str] = DEFAULT_FILLERS, gap_s: float = 2.0, flush_s: float = 3.0,
                 pending_max_s: float = 4.0, hold_s: float = 0.0) -> None:
        self.mapper = mapper
        self.on_turn = on_turn
        self.filler_list = list(filler_list)
        self.gap_s = gap_s
        self.flush_s = flush_s
        self.pending_max_s = pending_max_s
        self.hold_s = hold_s  # > 0: hold opening turns until the speaker mapping is settled
        self._held: List[List[Word]] = []
        self._hold_over = False
        self._cur: List[Word] = []
        self._n = 0
        self._final_until = 0.0  # end of the latest final word, any speaker
        self._heard_until = 0.0  # end of the latest interim word

    def add(self, words: Iterable[Word]) -> None:
        self._maybe_release()
        for w in words:
            if self._cur and (w.label != self._cur[-1].label or w.start - self._cur[-1].end > self.gap_s):
                self._close()
            self._cur.append(w)
            self._final_until = max(self._final_until, w.end)

    def heard(self, interim_end: float) -> None:
        """An interim result reached `interim_end` (audio seconds): someone is still talking."""
        self._heard_until = max(self._heard_until, interim_end)

    @property
    def pending(self) -> bool:
        """Interim words beyond the last final word: their final has not arrived yet."""
        return self._heard_until > self._final_until + 0.3

    def tick(self, now: float) -> None:
        """Call often with the audio clock; closes a turn once its speaker has gone quiet
        and no final is still on its way."""
        self._maybe_release(now)
        if not self._cur or now - self._cur[-1].end <= self.flush_s:
            return
        if self.pending and now - self._heard_until <= self.pending_max_s:
            return
        self._close()

    def flush(self) -> None:
        if self._cur:
            self._close()
        self._hold_over = True
        self._release()

    def _close(self) -> None:
        words, self._cur = self._cur, []
        if self.hold_s > 0 and not self._hold_over and not self.mapper.settled:
            self._held.append(words)  # who is `me` is still a guess: wait for the loudness check
            return
        self._release()
        self._emit(words)

    def _emit(self, words: List[Word]) -> None:
        self._n += 1
        self.on_turn(make_turn_event(self._n, self.mapper.speaker(words[0].label), words, self.filler_list))

    def _release(self) -> None:
        held, self._held = self._held, []
        for words in held:
            self._emit(words)

    def _maybe_release(self, now: Optional[float] = None) -> None:
        """Opening turns go out once the speakers are settled, or after hold_s regardless
        (one speaker only, or no loudness); after that nothing is ever held again."""
        if not self._held:
            return
        if self.mapper.settled or (now is not None and now - self._held[0][-1].end > self.hold_s):
            self._hold_over = True
            self._release()


class FluxTurnAssembler:
    """Turns from Flux end-of-turn windows, words and speakers from Nova."""

    def __init__(self, mapper: SpeakerMapper, on_turn: Callable[[dict], None],
                 filler_list: Iterable[str] = DEFAULT_FILLERS, slack_s: float = 0.3,
                 leftover_s: float = 4.0, max_offset_s: float = 0.3) -> None:
        self.mapper = mapper
        self.on_turn = on_turn
        self.filler_list = list(filler_list)
        self.slack_s = slack_s
        self.leftover_s = leftover_s
        self.max_offset_s = max_offset_s
        self._buf: List[Word] = []
        self._n = 0
        self.offsets: List[float] = []

    @property
    def misaligned(self) -> bool:
        """True once 5+ windows show the two clocks more than max_offset_s apart."""
        return len(self.offsets) >= 5 and statistics.median(self.offsets) > self.max_offset_s

    def add(self, words: Iterable[Word]) -> None:
        self._buf.extend(words)
        self._buf.sort(key=lambda w: w.start)

    def end_of_turn(self, window_start: float, window_end: float) -> None:
        lo, hi = window_start - self.slack_s, window_end + self.slack_s
        inside = [w for w in self._buf if w.start >= lo and w.end <= hi]
        if not inside:
            return
        self.offsets.append(abs(inside[-1].end - window_end))
        self._buf = [w for w in self._buf if w not in inside]
        self._emit(inside)

    def tick(self, now: float) -> None:
        """Words no Flux window claimed (Flux missed a turn): group them Nova-style."""
        old = [w for w in self._buf if now - w.end > self.leftover_s]
        if not old:
            return
        self._buf = [w for w in self._buf if w not in old]
        run: List[Word] = []
        for w in old:
            if run and w.label != run[-1].label:
                self._emit(run)
                run = []
            run.append(w)
        if run:
            self._emit(run)

    def _emit(self, words: List[Word]) -> None:
        weight: Dict[int, float] = {}
        for w in words:
            weight[w.label] = weight.get(w.label, 0.0) + max(w.end - w.start, 0.05)
        label = max(weight, key=weight.get)
        self._n += 1
        self.on_turn(make_turn_event(self._n, self.mapper.speaker(label), words, self.filler_list))


# ---------- pace ----------

def _merged_spans(words: Sequence[Word], join_gap: float = 0.6) -> List[Tuple[float, float]]:
    spans: List[Tuple[float, float]] = []
    for w in sorted(words, key=lambda w: w.start):
        if spans and w.start - spans[-1][1] <= join_gap:
            spans[-1] = (spans[-1][0], max(spans[-1][1], w.end))
        else:
            spans.append((w.start, w.end))
    return spans


class RollingPace:
    """Wearer's live words per minute: final words in the last `window_s` divided by the
    wearer's speaking time in that window (plan.md 3.2). Interims are never used."""

    def __init__(self, window_s: float = 15.0, min_speaking_s: float = 3.0) -> None:
        self.window_s = window_s
        self.min_speaking_s = min_speaking_s
        self._words: List[Word] = []

    def add(self, words: Iterable[Word]) -> None:
        self._words.extend(words)

    def wpm(self, now: float) -> Optional[float]:
        lo = now - self.window_s
        self._words = [w for w in self._words if w.end > lo - 5]
        ws = [w for w in self._words if lo < w.end <= now]
        speaking = sum(min(e, now) - max(s, lo) for s, e in _merged_spans(ws) if e > lo)
        if speaking < self.min_speaking_s:
            return None
        return round(len(ws) / speaking * 60, 1)


class BaselinePace:
    """Pace over the wearer's first `seconds` of speaking (used when there is no history yet)."""

    def __init__(self, seconds: float = 30.0) -> None:
        self.seconds = seconds
        self._words: List[Word] = []
        self.value: Optional[float] = None

    def add(self, words: Iterable[Word]) -> Optional[float]:
        if self.value is not None:
            return self.value
        self._words.extend(words)
        speaking = sum(e - s for s, e in _merged_spans(self._words))
        if speaking >= self.seconds:
            self.value = round(len(self._words) / speaking * 60, 1)
        return self.value


def partial_event(mapper: SpeakerMapper, words: Sequence[Word], text: str) -> dict:
    """transcript.partial for the live caption line. Speaker = majority label, or None."""
    speaker = None
    if words:
        weight: Dict[int, float] = {}
        for w in words:
            weight[w.label] = weight.get(w.label, 0.0) + max(w.end - w.start, 0.05)
        label = max(weight, key=weight.get)
        if mapper.me_label is not None or mapper.single_speaker:
            speaker = mapper.speaker(label)
    return {"type": "transcript.partial", "speaker": speaker, "text": text}
