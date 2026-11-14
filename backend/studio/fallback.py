"""Deterministic fallback coach and goal helpers (no I/O, never raises for any string)."""

from __future__ import annotations

import re

from backend.contracts import CoachSpec, NudgeRule
from backend.studio.default import DEFAULT_FILLERS, default_coach
from backend.studio.validate import MAX_MESSAGE_CHARS

MAX_GOAL_CHARS = 500
MAX_NAME_CHARS = 60
MAX_SLUG_CHARS = 40
DEFAULT_GOAL = "Speak clearly and confidently in conversation."
DEFAULT_NAME = "Custom Coach"

# Fillers that are almost never meant literally when named in a goal.
_UNAMBIGUOUS_FILLERS = ("um", "uh", "er", "erm", "ah", "hmm", "basically", "literally",
                        "you know", "i mean", "you know what i mean")
# Common words that are fillers only when the goal says the wearer *says* them.
_AMBIGUOUS_FILLERS = ("like", "actually", "kind of", "sort of", "right", "okay", "honestly",
                      "anyway", "totally", "so yeah", "just")
_QUOTED_RE = re.compile(r"(?:^|(?<=[\s(\[:]))[\"'“‘]([^\"'“”‘’]{1,24})[\"'”’](?=$|[\s,.;:!?)\]])")
_SAYING_RE = re.compile(r"\b(?:saying|say|says|use|using|said|words?)\b([^.,;!?]{0,40})", re.IGNORECASE)
_WINDOW_STOP_RE = re.compile(r"\b(?:in|when|during|at|while|to|and sound|and be|so much|all the time|too much)\b")

# (keywords, focus rule id) checked in order; first match wins.
_FOCUS_KEYWORDS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("interrupt", "cut people off", "cutting people off", "talk over", "talking over", "let them finish",
      "let people finish"), "interrupt"),
    (("filler", "crutch word", "verbal tic"), "filler"),
    (("ramble", "rambling", "concise", "boring", "long-winded", "long winded", "too long", "shorter",
      "brief", "to the point", "monolog", "talk less", "talk too much"), "monologue"),
    (("confident", "confidence", "hedge", "hedging", "senior", "assertive", "authority", "decisive",
      "executive", "leader"), "hedge"),
    (("fast", "pace", "slow", "speed", "rush", "breathe"), "pace"),
)


def clean_goal(goal: object) -> str:
    """Trimmed, single-spaced, capped goal text; never empty."""
    text = goal if isinstance(goal, str) else ""
    text = re.sub(r"\s+", " ", text).strip()
    text = "".join(ch for ch in text if ch.isprintable())
    return text[:MAX_GOAL_CHARS].strip() or DEFAULT_GOAL


def slugify(text: str, max_len: int = MAX_SLUG_CHARS) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    slug = slug[:max_len].strip("-")
    return slug or "coach"


def coach_id(seed: str) -> str:
    """`custom-<slug>`, at most 64 chars, matches KEY_RE."""
    slug = slugify(seed)
    if slug.startswith("custom-"):
        slug = slug[len("custom-"):] or "coach"
    return f"custom-{slug}"[:64].strip("-")


def cap_name(name: str, max_len: int = MAX_NAME_CHARS) -> str:
    """Single-spaced name cut at a word boundary."""
    text = re.sub(r"\s+", " ", name or "").strip()
    if len(text) <= max_len:
        return text
    cut = text[:max_len].rsplit(" ", 1)[0].rstrip(" ,.;:-")
    return cut or text[:max_len]


def name_from_goal(goal: str) -> str:
    text = re.sub(r"\s+", " ", goal).strip().rstrip(".!?")
    if not text or text == DEFAULT_GOAL.rstrip("."):
        return DEFAULT_NAME
    return cap_name(text[0].upper() + text[1:], 40) or DEFAULT_NAME


def _has_word(text: str, phrase: str) -> bool:
    return re.search(rf"(?<![a-z']){re.escape(phrase)}(?![a-z'])", text) is not None


def mentioned_fillers(goal: str) -> list[str]:
    """Filler words the goal names: quoted words, unambiguous fillers, or 'saying X' fillers."""
    found: list[str] = []

    def add(word: str) -> None:
        w = re.sub(r"\s+", " ", word).strip().lower()
        if w and len(w) <= 24 and len(w.split()) <= 3 and w not in found:
            found.append(w)

    for m in _QUOTED_RE.finditer(goal or ""):
        add(m.group(1))
    lower = (goal or "").lower()
    for m in _SAYING_RE.finditer(lower):
        window = _WINDOW_STOP_RE.split(m.group(1), maxsplit=1)[0]
        hits = [(window.find(f), f) for f in (*_UNAMBIGUOUS_FILLERS, *_AMBIGUOUS_FILLERS)
                if _has_word(window, f)]
        for _, f in sorted(hits):
            add(f)
    for f in _UNAMBIGUOUS_FILLERS:
        if _has_word(lower, f):
            add(f)
    return found


def merge_words(first: list[str], rest: list[str], limit: int = 30) -> list[str]:
    """`first` then `rest`, deduped case-insensitively, empties removed."""
    out: list[str] = []
    seen: set[str] = set()
    for word in [*first, *rest]:
        w = (word or "").strip()
        if w and w.lower() not in seen:
            seen.add(w.lower())
            out.append(w)
    return out[:limit]


def pick_focus(goal: str) -> str:
    """Focus rule id of the Core Coach most central to the goal, by keyword."""
    text = f" {goal.lower()} "
    for keywords, rule_id in _FOCUS_KEYWORDS:
        if rule_id == "filler" and mentioned_fillers(goal):
            return rule_id
        if any(k in text for k in keywords):
            return rule_id
    return "interrupt"


def _filler_message(fillers: list[str]) -> str:
    if fillers:
        msg = f"Pause instead of '{fillers[0]}'"
        if len(msg) <= MAX_MESSAGE_CHARS:
            return msg
    return "Pause instead"


def fallback_coach(goal: str) -> CoachSpec:
    """A valid custom coach derived from the Core Coach, adapted to the goal by keywords."""
    clean = clean_goal(goal)
    base = default_coach()
    fillers = mentioned_fillers(clean)
    focus = pick_focus(clean)
    rules: list[NudgeRule] = []
    for rule in base.nudge_rules:
        if rule.id == "filler" and fillers:
            rule = rule.model_copy(update={"message": _filler_message(fillers)})
        rules.append(rule)
    rubric = (f"This is a custom coach for the goal: {clean[:200]!r}. Focus habit: {focus}. "
              + base.debrief_rubric)
    return base.model_copy(update={
        "id": coach_id(clean),
        "name": name_from_goal(clean),
        "goal": clean,
        "kind": "custom",
        "keyterms": merge_words(fillers, []),
        "filler_words": merge_words(fillers, list(DEFAULT_FILLERS)),
        "nudge_rules": rules,
        "nudge_policy": base.nudge_policy.model_copy(update={"focus_rule_id": focus}),
        "debrief_rubric": rubric,
    })
