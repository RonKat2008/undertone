"""Filler words. Deepgram Nova-3 keeps "um"/"uh" only with filler_words=true."""
from __future__ import annotations

import re
from typing import Iterable, List

# "like" and "actually" are left out on purpose: as plain words they are too often not fillers.
# A coach (or the personal coach) can add them to its own filler_words.
DEFAULT_FILLERS = ["um", "uh", "uhm", "erm", "hmm", "you know", "i mean", "basically",
                   "literally", "kind of", "sort of", "so yeah"]

_WORD = re.compile(r"[a-z']+")


def norm(word: str) -> str:
    return "".join(_WORD.findall(word.lower()))


def find_fillers(words: Iterable[str], filler_list: Iterable[str] = DEFAULT_FILLERS) -> List[str]:
    """Return every filler in order of appearance. Multi-word fillers ("you know") match first,
    and their words are not counted again as single fillers."""
    toks = [norm(w) for w in words]
    toks = [t for t in toks if t]
    phrases = sorted({tuple(f.lower().split()) for f in filler_list}, key=len, reverse=True)
    out: List[str] = []
    i = 0
    while i < len(toks):
        for p in phrases:
            if tuple(toks[i:i + len(p)]) == p:
                out.append(" ".join(p))
                i += len(p)
                break
        else:
            i += 1
    return out
