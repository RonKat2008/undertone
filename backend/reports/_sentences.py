"""Plain-language sentences built only from numbers. Behaviour, never personality; the wearer is
compared only with their own other conversations or their own previous window."""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from backend.contracts import ReportComparison, ReportDelta, ReportHabitCount


def num(value: float) -> str:
    """One decimal, half up (2.75 -> 2.8, 1.25 -> 1.3), no trailing zero."""
    rounded = Decimal(repr(value)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    return f"{float(rounded):g}"


def times(ratio: float) -> str:
    return "twice" if round(ratio, 1) == 2.0 else f"{num(ratio)}x"


def _pct(value: float) -> str:
    return f"{value:.0%}"


def person_sentence(name: str, c: ReportComparison) -> str:
    v, u, r = c.value or 0.0, c.usual or 0.0, c.ratio or 1.0
    up = v > u
    if c.metric == "interruptions":
        if up:
            return (f"You interrupt {name} {times(r)} as often as in your other conversations "
                    f"({num(v)} against {num(u)} a conversation).")
        return f"You interrupt {name} less than elsewhere ({num(v)} against {num(u)} a conversation)."
    if c.metric == "questions":
        word = "more" if up else "fewer"
        return f"You ask {name} {word} questions than elsewhere ({num(v)} against {num(u)} a conversation)."
    if c.metric == "talk_ratio":
        return f"You talk {_pct(v)} of the time with {name}, against {_pct(u)} elsewhere."
    if c.metric == "fillers_per_min":
        return f"You use {num(v)} filler words a minute with {name}, against {num(u)} elsewhere."
    word = "faster" if up else "slower"
    return f"You speak {word} with {name}: {round(v):g} words a minute against {round(u):g} elsewhere."


def topic_sentence(label: str, c: ReportComparison) -> str:
    v, u = c.value or 0.0, c.usual or 0.0
    if c.metric == "wpm":
        word = "faster" if v > u else "slower"
        return f"On {label} you speak {word}: {round(v):g} words a minute against {round(u):g} elsewhere."
    if c.metric == "fillers_per_min":
        word = "more" if v > u else "fewer"
        return f"On {label} you use {word} filler words: {num(v)} a minute against {num(u)} elsewhere."
    return f"When {label} comes up you talk {_pct(v)} of the time, against {_pct(u)} elsewhere."


_MEASURE_WORDS: dict[str, tuple[str, str]] = {
    # metric: (subject, unit) for "<subject> <value> <unit>, down from <previous>"
    "talk_ratio": ("You talked", "of the time"),
    "interruptions": ("You interrupted", "times a conversation"),
    "questions": ("You asked", "questions a conversation"),
    "fillers_per_min": ("You used", "filler words a minute"),
}


def measure_sentence(d: ReportDelta, days: int) -> str | None:
    words = _MEASURE_WORDS.get(d.metric)
    if words is None or d.current is None or d.previous is None or d.direction not in ("up", "down"):
        return None
    fmt = _pct if d.metric == "talk_ratio" else num
    way = "up" if d.direction == "up" else "down"
    return f"{words[0]} {fmt(d.current)} {words[1]}, {way} from {fmt(d.previous)} in the {days} days before."


def habit_sentence(h: ReportHabitCount, days: int) -> str | None:
    t = h.trend
    if t.current is None or t.previous is None or t.direction not in ("up", "down"):
        return None
    way = "up" if t.direction == "up" else "down"
    if t.current == 0:
        return f"{h.label} did not show up, down from {num(t.previous)} times a conversation in the {days} days before."
    return (f"{h.label} showed up {num(t.current)} times a conversation, {way} from {num(t.previous)} "
            f"in the {days} days before.")


def promises_sentence(open_count: int, oldest_days: int) -> str:
    noun = "promise is" if open_count == 1 else "promises are"
    age = "today" if oldest_days == 0 else f"{oldest_days} day{'s' if oldest_days != 1 else ''} ago"
    return f"{open_count} {noun} still open; the oldest was made {age}."


def topic_highlight(label: str, conversations: int) -> str:
    return f"{label.capitalize()} came up most: {conversations} conversations."


def insufficient_sentence(current: int, previous: int, days: int) -> str:
    return (f"{current} conversation{'s' if current != 1 else ''} in the last {days} days and {previous} in the "
            f"{days} before: too few to compare with your past yet.")
