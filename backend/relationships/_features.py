"""How two people talk (features) -> what the relationship is (kind). Pure and deterministic.

Both paths fill the same Features: the Decisions path from closed questions, the rule path from
keyword patterns. One decision list maps them to a kind, so every label can be explained:

    1 family terms used to each other          -> family
    2 pet names / affection, not strangers     -> partner
    3 one serves the other (a purchase, a fee) -> service (they serve me) | client (I serve them)
    4 one teaches the other                    -> teacher (they teach me) | student (I teach them)
    5 work talk, or the same team or company:
        they direct the work, or I ask them for approval -> boss
        I direct the work, or they ask me for approval   -> report
        otherwise                                         -> coworker
    6 familiarity: close -> friend, acquainted -> acquaintance, strangers -> stranger
    7 nothing decisive                          -> unknown ("mixed signals")

Confidence = the deciding signal's probability x a speech factor (more speech, more confidence),
capped per source. Below UNKNOWN_BELOW the answer is `unknown`.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from backend.contracts import RelationshipFormality, RelationshipKind, RelationshipPower, RelationshipSource

YES = 0.5
UNKNOWN_BELOW = 0.35
FULL_SPEECH_WORDS = 400  # this much speech earns the full confidence
MIN_SPEECH_FACTOR = 0.7
CAPS: dict[str, float] = {"decisions": 0.95, "rules": 0.5}
MAX_EVIDENCE = 3

EVIDENCE: dict[tuple[str, str], str] = {
    ("power", "they_lead"): "they assign you tasks",
    ("power", "i_lead"): "you assign them tasks",
    ("permission", "i_ask"): "you ask them for approval",
    ("permission", "they_ask"): "they ask you for approval",
    ("formality", "formal"): "formal, polite address",
    ("formality", "casual"): "casual, first-name talk",
    ("familiarity", "close"): "shared history and in-jokes",
    ("familiarity", "acquainted"): "some shared history",
    ("familiarity", "strangers"): "no shared history",
    ("topic", "work"): "mostly work topics",
    ("topic", "personal"): "mostly personal topics",
    ("topic", "service"): "a purchase or a quick request",
    ("topic", "study"): "lessons and coursework",
    ("service", "they_serve"): "they serve you as staff",
    ("service", "i_serve"): "you serve them as a client",
    ("teaching", "they_teach"): "they teach you",
    ("teaching", "i_teach"): "you teach them",
    ("family", "yes"): "family terms of address",
    ("affection", "yes"): "pet names and affection",
    ("joking", "yes"): "joking and teasing",
    ("same_org", "yes"): "same team or company",
}


@dataclass(frozen=True)
class Signal:
    value: str = "unknown"
    p: float = 0.0  # how strongly the value holds, 0-1

    def is_(self, value: str, at: float = YES) -> bool:
        return self.value == value and self.p >= at


@dataclass(frozen=True)
class Features:
    power: Signal = field(default_factory=Signal)  # they_lead | peer | i_lead
    permission: Signal = field(default_factory=Signal)  # i_ask | they_ask | neither
    formality: Signal = field(default_factory=Signal)  # casual | neutral | formal
    familiarity: Signal = field(default_factory=Signal)  # strangers | acquainted | close
    topic: Signal = field(default_factory=Signal)  # work | personal | service | study | mixed | other
    service: Signal = field(default_factory=Signal)  # they_serve | i_serve | none
    teaching: Signal = field(default_factory=Signal)  # they_teach | i_teach | none
    family: float = 0.0  # probabilities
    affection: float = 0.0
    joking: float = 0.0
    same_org: float = 0.0


@dataclass(frozen=True)
class Inference:
    kind: RelationshipKind
    confidence: float
    formality: RelationshipFormality
    power: RelationshipPower
    warmth: float
    evidence: tuple[str, ...]
    source: RelationshipSource


def _decide(f: Features) -> tuple[RelationshipKind, float, list[tuple[str, str]]]:
    """(kind, deciding probability, evidence keys in order of weight)."""
    if f.family >= YES:
        return "family", f.family, [("family", "yes")]
    if f.affection >= YES and f.familiarity.value != "strangers":
        return "partner", f.affection, [("affection", "yes")]
    if f.service.is_("they_serve"):
        return "service", f.service.p, [("service", "they_serve")]
    if f.service.is_("i_serve"):
        return "client", f.service.p, [("service", "i_serve")]
    if f.teaching.is_("they_teach"):
        return "teacher", f.teaching.p, [("teaching", "they_teach")]
    if f.teaching.is_("i_teach"):
        return "student", f.teaching.p, [("teaching", "i_teach")]
    work = max(f.topic.p if f.topic.value in ("work", "mixed") else 0.0, f.same_org)
    if work >= YES:
        lead = max(f.power.p if f.power.value == "they_lead" else 0.0,
                   f.permission.p if f.permission.value == "i_ask" else 0.0)
        follow = max(f.power.p if f.power.value == "i_lead" else 0.0,
                     f.permission.p if f.permission.value == "they_ask" else 0.0)
        if lead >= YES and lead > follow:
            return "boss", min(lead, work), [("power", "they_lead"), ("permission", "i_ask")]
        if follow >= YES:
            return "report", min(follow, work), [("power", "i_lead"), ("permission", "they_ask")]
        return "coworker", work * 0.85, [("same_org", "yes"), ("topic", "work")]
    if f.familiarity.is_("close"):
        return "friend", f.familiarity.p, [("familiarity", "close"), ("joking", "yes")]
    if f.familiarity.is_("acquainted"):
        return "acquaintance", f.familiarity.p * 0.9, [("familiarity", "acquainted")]
    if f.familiarity.is_("strangers"):
        return "stranger", f.familiarity.p, [("familiarity", "strangers")]
    return "unknown", 0.0, []


def _holds(f: Features, key: tuple[str, str]) -> bool:
    name, value = key
    attr = getattr(f, name)
    if isinstance(attr, float):
        return attr >= YES
    return attr.is_(value)


def _evidence(f: Features, keys: list[tuple[str, str]]) -> tuple[str, ...]:
    support = [("formality", f.formality.value), ("joking", "yes"), ("topic", f.topic.value),
               ("familiarity", f.familiarity.value)]
    out: list[str] = []
    for key in [*keys, *support]:
        line = EVIDENCE.get(key)
        if line and line not in out and _holds(f, key):
            out.append(line)
    return tuple(out[:MAX_EVIDENCE])


def _warmth(f: Features) -> float:
    base = {"strangers": 0.15, "acquainted": 0.45, "close": 0.75}.get(f.familiarity.value, 0.4)
    w = base + 0.1 * f.joking + 0.15 * f.affection + (0.1 if f.family >= YES else 0.0)
    w -= 0.1 if f.formality.is_("formal") else 0.0
    return round(min(1.0, max(0.0, w)), 2)


ROLE_KINDS = frozenset({"boss", "report", "coworker", "client", "service", "teacher", "student"})


def _power(f: Features, kind: str) -> RelationshipPower:
    """The direction signal; asking permission stands in for it only in role relationships
    (between friends or partners 'do you want me to...' is an offer, not deference)."""
    if f.power.p >= YES and f.power.value in ("they_lead", "peer", "i_lead"):
        return f.power.value  # type: ignore[return-value]
    if kind not in ROLE_KINDS:
        return "unknown"
    if f.permission.is_("i_ask"):
        return "they_lead"
    if f.permission.is_("they_ask"):
        return "i_lead"
    return "unknown"


def _formality(f: Features) -> RelationshipFormality:
    v = f.formality.value
    return v if v in ("casual", "formal") and f.formality.p >= YES else "neutral"  # type: ignore[return-value]


def speech_factor(words: int) -> float:
    return MIN_SPEECH_FACTOR + (1 - MIN_SPEECH_FACTOR) * min(1.0, words / FULL_SPEECH_WORDS)


def map_features(f: Features, words: int, source: RelationshipSource) -> Inference:
    kind, p, keys = _decide(f)
    confidence = round(min(CAPS.get(source, 0.5), p * speech_factor(words)), 2)
    if kind == "unknown" or p < UNKNOWN_BELOW:
        return Inference(kind="unknown", confidence=0.0, formality=_formality(f), power=_power(f, "unknown"),
                         warmth=_warmth(f), evidence=("mixed signals",), source=source)
    return Inference(kind=kind, confidence=confidence, formality=_formality(f), power=_power(f, kind),
                     warmth=_warmth(f), evidence=_evidence(f, keys) or ("mixed signals",), source=source)
