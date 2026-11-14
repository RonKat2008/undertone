"""Compiled regexes and small text helpers for the rule judge (private)."""

from __future__ import annotations

import re

_I = re.IGNORECASE

WORD = re.compile(r"[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*")
SENTENCE = re.compile(r"[^.?!]+[.?!]*")
CUTOFF_END = re.compile(r"(?:—|–|--|-|\.\.\.|…)\s*$")
BACKCHANNEL = re.compile(
    r"^\W*(?:(?:mm+-?hm+|uh-?huh|yeah|yep|yes|right|okay|ok|sure|got it|i see|wow|oh|totally)\W*){1,3}$", _I
)
BACKCHANNEL_OPEN = re.compile(r"^\W*(?:mm+-?hm+|uh-?huh|right|got it|i see)\b", _I)

TEXT_FILLER = re.compile(r"\b(?:um+|uh+|er+m?|hmm+|you know)\b|(?:^|,)\s*like\s*,", _I)
HEDGE = re.compile(
    r"\b(?:i think maybe|i guess|i suppose|maybe|perhaps|sort of|kind of|possibly|probably|"
    r"i'?m not (?:totally |really |entirely |quite |a hundred percent )?sure|i don'?t know|"
    r"it'?s possible that|might|could be|could sort|at some point|if i get a chance|i'?ll try|"
    r"whenever|more or less)\b",
    _I,
)
RESTART = re.compile(
    r"\b(?:sorry|let me start over|let me rephrase|start again|what i mean is)\b|\b(\w+),\s+\1\b", _I
)
TOPIC_SHIFT = re.compile(
    r"\b(?:that reminds me|anyway|whole other|speaking of|which honestly|but,? ?so|so,? yeah|"
    r"long story short|where was i)\b",
    _I,
)
SPECIFIC = re.compile(
    r"\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty|forty|fifty|"
    r"sixty|hundred|thousand|million|percent|first|second|third|reasons?)\b",
    _I,
)

# ---------- questions ----------
_LEAD_IN = r"^\W*(?:(?:so|and|but|okay|ok|well|oh|um|uh|hey|then|also|just|wait|hi)\W+)*"
OPEN_Q = re.compile(_LEAD_IN + r"(?:how|what|why|tell me|walk me|describe|explain)\b", _I)
NEG_AUX = r"(?:is|are|do|does|did|wo|would|ca|could|should|have|has|was|were|ai)n'?t"
LEADING_Q = re.compile(
    _LEAD_IN + NEG_AUX + r"\s+(?:you|we|it|that|this|they|there|he|she)\b"
    r"|\bwouldn'?t you agree\b|\b(?:obviously|clearly|surely)\b"
    r"|,\s*(?:right|correct|yeah|no|huh|" + NEG_AUX + r"\s+\w+)\s*\?\s*$",
    _I,
)
INTERROGATIVE = re.compile(
    _LEAD_IN + r"(?:(?:do|did|does|is|are|was|were|can|could|would|will|should|have|has)\s+"
    r"(?:you|we|they|i|he|she|it|this|that|there|the|your|our)\b"
    r"|(?:what|how|why|where|when|who)\s+(?:do|did|does|is|are|was|were|can|could|would|will|"
    r"should|has|have|'s)\b)",
    _I,
)
OTHER_REQUEST = re.compile(
    r"\b(?:can you|could you|would you|will you|tell me|walk me|let me know|describe|explain|"
    r"please|what|how|why|who|which|when)\b",
    _I,
)
DEFLECT = re.compile(
    r"\b(?:great|good|interesting) question\b|\bbefore i answer\b|\bi'?d (?:love|like) to first\b|"
    r"\blet me start over\b|\blet'?s come back to\b|\bi'?d rather not\b|\bcan we talk about\b",
    _I,
)
DIRECT_OPEN = re.compile(
    r"^\W*(?:yes|yeah|yep|no|nope|sure|absolutely|definitely|i'?ll|i will|\d|one|two|three|four|five|"
    r"six|seven|eight|nine|ten|about|around|it'?s|it was|we|i)\b",
    _I,
)

# ---------- acknowledgement / tone ----------
ACK = re.compile(
    r"\bthat sounds\b|\byou'?re (?:not )?(?:wrong|right)\b|\bi hear (?:that|you)\b|"
    r"\bthat'?s (?:a )?(?:fair|good|great|valid) (?:point|worry|question|concern)\b|"
    r"\b(?:good|fair) point\b|\bfair enough\b|\bmakes sense\b|"
    r"\bthat'?s (?:so |really )?(?:awesome|frustrating|great|amazing|hard|tough|rough|exciting|"
    r"wonderful|fantastic|cool|brutal|terrible|awful)\b|\boh,? (?:nice|wow|no)\b|\bwelcome back\b|"
    r"\bcongrat|\bthanks? (?:you )?(?:so much )?for\b|\bno way\b|\bsorry to hear\b|\bi'?m so sorry\b",
    _I,
)
DEFENSIVE = re.compile(
    r"\bnot on me\b|\bnot my (?:fault|job|problem)\b|\bexactly (?:like|what|as) (?:you|the)\b|"
    r"\bit was fine\b|\bi followed\b|\bnever (?:was )?fair\b|\bwasn'?t fair\b|\bin the first place\b|"
    r"\bthat'?s not true\b|\bi did what\b|\bblame\b|\bnot my call\b|\bwhat was i supposed to\b",
    _I,
)
WARM = re.compile(r"\bthank(?:s| you) so much\b|\bso happy for\b|\bthat'?s awesome\b|\blove that\b", _I)

# ---------- commitments ----------
FUTURE_SELF = re.compile(r"\b(?:i'?ll|i will|i'?m going to|i am going to|i'?m gonna|i can)\b", _I)
ACTION = re.compile(
    r"\b(?:send|email|call|review|share|follow up|get back|write|draft|book|schedule|set up|fix|"
    r"look into|check|ping|text|update|finish|deliver|put together|walk|loop|reach out|talk to|"
    r"meet|submit|prepare|order|pay|read|test|deploy|ship|file|forward|copy|introduce|confirm|"
    r"handle|take care|bring|pick up|drop off|post|publish|run|start|merge|sign)\b",
    _I,
)
TIME = re.compile(
    r"\b(?:tonight|today|tomorrow|this (?:morning|afternoon|evening|week|weekend)|next (?:week|month|"
    r"monday|tuesday|wednesday|thursday|friday)|monday|tuesday|wednesday|thursday|friday|saturday|"
    r"sunday|by \w+|before \w+|end of (?:the )?(?:day|week)|eod|noon|first thing|right after|"
    r"after (?:this|the|lunch)|in (?:an?|one|two|three|\d+) (?:hours?|minutes?|days?)|at \d|"
    r"at (?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)|later today)\b",
    _I,
)
OWNER = re.compile(r"(?<!^)(?<![.?!]\s)\b(?!I\b)[A-Z][a-z]+\b")
SOFTENER = re.compile(
    r"\b(?:try|might|maybe|perhaps|if i get a chance|when i can|at some point|sometime|someday|"
    r"whenever|hopefully|possibly|probably)\b",
    _I,
)


def words(text: str) -> list[str]:
    return WORD.findall(text)


def sentences(text: str) -> list[str]:
    return [s.strip() for s in SENTENCE.findall(text) if s.strip(" \t\n.?!,")]
