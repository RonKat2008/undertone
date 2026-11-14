"""Cut a conversation into spans of speech worth embedding. Pure: no audio, no model."""

from __future__ import annotations

from collections.abc import Sequence
from itertools import pairwise

from backend.voices.types import Span, TimedWord, TurnSpan, VoiceConfig

_SENTENCE_END = (".", "?", "!")


def _span_of(words: Sequence[TimedWord], idx: list[int]) -> Span:
    first, last = words[idx[0]], words[idx[-1]]
    return Span(start=first.start, end=last.end, label=first.label, words=tuple(idx))


def _breaks_before(words: Sequence[TimedWord], cur: list[int], i: int, cfg: VoiceConfig) -> bool:
    """True when word i cannot join the span `cur`."""
    prev, word = words[cur[-1]], words[i]
    if word.label != prev.label:
        return True
    if word.start - prev.end > cfg.word_gap_s:
        return True
    if word.end - words[cur[0]].start > cfg.max_span_s:
        return True
    duration = prev.end - words[cur[0]].start
    return prev.text.rstrip().endswith(_SENTENCE_END) and duration >= cfg.min_embed_s


def spans_from_words(words: Sequence[TimedWord], cfg: VoiceConfig) -> list[Span]:
    """Consecutive same-label words, cut at label changes, pauses, max length, sentence ends."""
    spans: list[Span] = []
    cur: list[int] = []
    for i in range(len(words)):
        if cur and _breaks_before(words, cur, i, cfg):
            spans.append(_span_of(words, cur))
            cur = []
        cur.append(i)
    if cur:
        spans.append(_span_of(words, cur))
    return spans


def _turn_windows(turn: TurnSpan, cfg: VoiceConfig) -> list[Span]:
    end = max(turn.start, turn.end)
    edges = [turn.start]
    while edges[-1] + cfg.window_s < end - 1e-9:
        edges.append(edges[-1] + cfg.window_s)
    edges.append(end)
    # The remainder is its own window unless it is too short to embed.
    if len(edges) > 2 and edges[-1] - edges[-2] < cfg.min_embed_s:
        edges = edges[:-2] + [edges[-1]]
    return [
        Span(start=a, end=b, label=None, turn_id=turn.turn_id)
        for a, b in pairwise(edges)
    ]


def spans_from_turns(turns: Sequence[TurnSpan], cfg: VoiceConfig) -> list[Span]:
    """Each turn cut into windows of about cfg.window_s (a short tail joins the previous)."""
    out: list[Span] = []
    for turn in turns:
        out.extend(_turn_windows(turn, cfg))
    return out


def _can_pool(a: Span, b: Span, cfg: VoiceConfig) -> bool:
    """a precedes b in time."""
    if a.label != b.label or a.turn_id != b.turn_id:
        return False
    if b.start - a.end > cfg.pool_gap_s:
        return False
    return b.end - a.start <= cfg.max_span_s


def _join(a: Span, b: Span) -> Span:
    return Span(start=a.start, end=b.end, label=a.label, words=a.words + b.words,
                turn_id=a.turn_id)


def _pool_once(spans: list[Span], cfg: VoiceConfig) -> list[Span] | None:
    """Merge the first poolable short span; None when nothing changes."""
    for i, s in enumerate(spans):
        if s.duration >= cfg.min_embed_s:
            continue
        if i > 0 and _can_pool(spans[i - 1], s, cfg):
            return spans[:i - 1] + [_join(spans[i - 1], s)] + spans[i + 1:]
        if i + 1 < len(spans) and _can_pool(s, spans[i + 1], cfg):
            return spans[:i] + [_join(s, spans[i + 1])] + spans[i + 2:]
    return None


def pool_short(spans: Sequence[Span], cfg: VoiceConfig) -> list[Span]:
    """Merge short spans into a same-label (same-turn) neighbour until stable."""
    current = list(spans)
    while True:
        nxt = _pool_once(current, cfg)
        if nxt is None:
            return current
        current = nxt


def embeddable(spans: Sequence[Span], cfg: VoiceConfig) -> list[int]:
    """Indices of spans long enough to embed."""
    return [i for i, s in enumerate(spans) if s.duration >= cfg.min_embed_s]
