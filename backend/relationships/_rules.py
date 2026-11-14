"""Rule fallback (no key, timeout, error): keyword and pattern features, deliberately weak.

Each pattern is counted per speaker, so "I need you to..." from OTHER means OTHER directs ME.
A signal's strength grows with hits (one hit is never decisive on its own for the work kinds),
and the mapped confidence is capped low by _features.CAPS["rules"].
"""

from __future__ import annotations

import re
from collections.abc import Iterable

from backend.relationships._features import Features, Signal
from backend.relationships._sample import Sample


def _rx(*words: str) -> re.Pattern[str]:
    return re.compile(r"\b(?:" + "|".join(words) + r")\b", re.I)


ASSIGN = _rx(r"i need you to", r"i want you to", r"make sure", r"can you have", r"by (?:monday|tuesday|wednesday|"
             r"thursday|friday|tomorrow|end of (?:day|week))", r"send me", r"i'?d like you to", r"please (?:also )?update",
             r"own the", r"i'?ll sign off", r"i'?ll approve")
PERMISSION = _rx(r"is it (?:ok|okay|alright|all right) if i", r"would it be (?:ok|okay|alright|all right) if i",
                 r"could i take", r"can i take", r"do you mind if i", r"should i run", r"do you want me to")
FORMAL = _rx(r"sir", r"ma'?am", r"mr\.?", r"mrs\.?", r"ms\.?", r"dr\.?", r"professor", r"certainly",
             r"good (?:morning|afternoon|evening),", r"we appreciate", r"look forward to")
CASUAL = _rx(r"dude", r"bro", r"haha+", r"lol", r"man,", r"no way", r"kidding", r"gonna", r"wanna", r"yeah")
FAMILY = _rx(r"mom", r"mum", r"dad", r"mommy", r"daddy", r"grandma", r"grandpa", r"your father", r"your mother",
             r"your brother", r"your sister", r"sweetie", r"son", r"auntie")
AFFECTION = _rx(r"babe", r"baby", r"honey", r"sweetheart", r"darling", r"love you", r"missed you",
                r"my love", r"our (?:apartment|bedroom|place|home)")
WORK = _rx(r"meeting", r"deadline", r"project", r"sprint", r"deck", r"report", r"quarterly", r"budget",
           r"ticket", r"standup", r"team", r"review", r"release", r"client", r"contract", r"proposal",
           r"forecast", r"hiring", r"leadership", r"board", r"quote")
PERSONAL = _rx(r"weekend", r"birthday", r"dinner", r"movie", r"party", r"vacation", r"gym", r"beach",
               r"game", r"drinks", r"summer", r"remember when")
SERVE = _rx(r"what can i get", r"for here or to go", r"that'?ll be", r"card or cash", r"would you like",
            r"your order", r"welcome in", r"anything else", r"receipt")
CLIENT = _rx(r"your business", r"your team", r"revised quote", r"for your sign-off", r"we can propose",
             r"thank you for meeting with us")
STRANGER = _rx(r"excuse me", r"sorry to bother you", r"do you know (?:how|where)", r"how (?:do i|to) get to",
               r"i'?m visiting", r"nice to meet you", r"enjoy your visit")
TEACH = _rx(r"homework", r"assignment", r"exam", r"lecture", r"office hours", r"class")


def _hits(lines: Iterable[str], pattern: re.Pattern[str]) -> int:
    return sum(len(pattern.findall(line)) for line in lines)


def _strength(hits: int, need: int = 1) -> float:
    """0 below `need` hits, then 0.5 rising 0.1 a hit, at most 0.8."""
    return 0.0 if hits < need else min(0.8, 0.5 + 0.1 * (hits - need))


def _side(me: int, other: int, mine: str, theirs: str, need: int = 2) -> Signal:
    if max(me, other) < need or me == other:
        return Signal()
    return Signal(theirs, _strength(other - me, need)) if other > me else Signal(mine, _strength(me - other, need))


def rule_features(sample: Sample) -> Features:
    me = [t.text for conv in sample.conversations for t in conv if t.speaker == "me"]
    other = [t.text for conv in sample.conversations for t in conv if t.speaker != "me"]
    both = me + other
    work, personal = _hits(both, WORK), _hits(both, PERSONAL)
    stranger = _hits(both, STRANGER)
    family, affection, casual = _hits(both, FAMILY), _hits(both, AFFECTION), _hits(both, CASUAL)
    formal = _hits(both, FORMAL)
    topic = Signal()
    if work >= 3 and work >= 2 * personal:
        topic = Signal("work", _strength(work, 3))
    elif personal >= 2 and personal >= 2 * work:
        topic = Signal("personal", _strength(personal, 2))
    familiarity = Signal()
    if stranger >= 2:
        familiarity = Signal("strangers", _strength(stranger, 2))
    elif casual + personal >= 4 or family + affection >= 2:
        familiarity = Signal("close", _strength(casual + personal, 4) or 0.6)
    formality = Signal("formal", 0.6) if formal >= 2 and formal > casual else \
        Signal("casual", 0.6) if casual >= 2 else Signal("neutral", 0.5)
    serve = _side(_hits(me, SERVE) + _hits(me, CLIENT), _hits(other, SERVE) + _hits(other, CLIENT),
                  "i_serve", "they_serve")
    return Features(
        power=_side(_hits(me, ASSIGN), _hits(other, ASSIGN), "i_lead", "they_lead"),
        permission=_side(_hits(me, PERMISSION), _hits(other, PERMISSION), "i_ask", "they_ask", need=1),
        formality=formality, familiarity=familiarity, topic=topic, service=serve,
        teaching=Signal(),  # who teaches whom is not reliable from keywords; Decisions only
        family=_strength(family, 2), affection=_strength(affection, 2),
        joking=_strength(casual, 2), same_org=0.0)
