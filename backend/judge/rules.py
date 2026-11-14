"""Pure, no-network rule judge: answers the ten core questions from text + timing alone.

    rule_judge(ctx, coach) -> dict[str, JudgeAnswer]

Coach-specific (non-core) questions get neutral, low-confidence answers, except the few with
simple patterns in judge/_coach_rules.py (matched by question id and type).
"""

from __future__ import annotations

from dataclasses import dataclass

from backend.contracts import (
    ChoiceAnswer, ChoiceQuestion, CoachQuestion, CoachSpec, JudgeAnswer, NoulAnswer, ScoreAnswer,
    TurnContext,
)
from backend.judge import _rule_patterns as rx
from backend.judge._coach_rules import COACH_RULES, STRATEGIES
from backend.judge.core_questions import CORE_QUESTION_IDS

__all__ = ["rule_judge"]

OVERLAP_S = 0.2
NEAR_GAP_S = 0.15
QTYPES = ("open", "closed", "leading", "none")
TONES = ("confident", "nervous", "defensive", "warm", "flat")
HEDGE_P = (0.08, 0.3, 0.7, 0.9)


@dataclass(frozen=True)
class _Feats:
    text: str
    words: int
    fillers: int
    hedges: int
    restarts: int
    asked_p: float
    qtype: str
    ack_p: float
    ramble_p: float
    prev_text: str | None


def _noul(p: float) -> NoulAnswer:
    p = round(min(0.99, max(0.01, p)), 3)
    return NoulAnswer(p=p, confidence=max(p, round(1 - p, 3)))


def _choice(options: tuple[str, ...], chosen: str, top: float) -> ChoiceAnswer:
    rest = round((1.0 - top) / (len(options) - 1), 4)
    probs = {o: (round(1.0 - rest * (len(options) - 1), 4) if o == chosen else rest) for o in options}
    return ChoiceAnswer(choice=chosen, probabilities=probs, confidence=probs[chosen])


# ---------- interrupted ----------
def _interrupted(ctx: TurnContext) -> float:
    prev = ctx.prev_other_turn
    if prev is None:
        return 0.03
    prev_text = prev.text.strip()
    cut = bool(rx.CUTOFF_END.search(prev_text)) and bool(prev_text.strip(".…—–- "))
    gap = ctx.turn.start - prev.end
    overlap = gap < -OVERLAP_S
    near = 0 <= gap < NEAR_GAP_S
    if rx.BACKCHANNEL.match(ctx.turn.text) and not cut:
        return 0.15 if overlap else 0.06
    if cut and (overlap or near):
        return 0.92
    if cut or overlap:
        return 0.85
    return 0.5 if near else 0.08


# ---------- questions ----------
def _is_rhetorical(sents: list[str], i: int) -> bool:
    if i + 1 >= len(sents):
        return False
    nxt = sents[i + 1]
    return not nxt.endswith("?") and len(rx.words(nxt)) <= 3


def _classify(sentence: str) -> str:
    if rx.LEADING_Q.search(sentence):
        return "leading"
    if rx.OPEN_Q.search(sentence):
        return "open"
    return "closed"


def _questions(text: str) -> tuple[float, str]:
    sents = rx.sentences(text)
    found: list[str] = []
    marked = False
    for i, s in enumerate(sents):
        if s.endswith("?"):
            kind = _classify(s)
            if kind != "leading" and _is_rhetorical(sents, i):
                continue
            if kind != "leading" and len(rx.HEDGE.findall(s)) >= 2 and not rx.INTERROGATIVE.search(s):
                continue  # uptalk on a hedged statement
            found.append(kind)
            marked = True
        elif rx.INTERROGATIVE.search(s):
            found.append(_classify(s))
    if not found:
        return 0.08, "none"
    best = next(k for k in ("leading", "open", "closed") if k in found)
    return (0.9 if marked else 0.62), best


# ---------- other features ----------
def _fillers(ctx: TurnContext) -> int:
    return max(len(ctx.turn.fillers), len(rx.TEXT_FILLER.findall(ctx.turn.text)))


def _ack(ctx: TurnContext, text: str) -> float:
    if ctx.prev_other_turn is None:
        return 0.1
    if rx.ACK.search(text):
        return 0.85
    if rx.BACKCHANNEL_OPEN.match(text) and len(rx.words(text)) > 4:
        return 0.7
    return 0.12


def _ramble(text: str, n_words: int, fillers: int, hedges: int) -> float:
    if n_words <= 25:
        return 0.05
    base = 0.12 if n_words <= 50 else (0.3 if n_words <= 70 else (0.5 if n_words <= 110 else 0.75))
    commas = text.count(",") / max(1, len(rx.sentences(text)))
    score = base + 0.2 * min(2, len(rx.TOPIC_SHIFT.findall(text)))
    score += 0.15 if fillers >= 2 else 0.0
    score += 0.15 if commas > 6 else 0.0
    score += 0.05 * min(3, hedges)
    if fillers <= 1 and len(rx.SPECIFIC.findall(text)) >= 3:
        score -= 0.3
    return min(0.95, max(0.05, score))


def _features(ctx: TurnContext) -> _Feats:
    text = ctx.turn.text.strip()
    n_words = len(rx.words(text))
    fillers = _fillers(ctx)
    hedges = len(rx.HEDGE.findall(text))
    asked_p, qtype = _questions(text)
    prev = ctx.prev_other_turn
    return _Feats(
        text=text, words=n_words, fillers=fillers, hedges=hedges,
        restarts=len(rx.RESTART.findall(text)), asked_p=asked_p, qtype=qtype,
        ack_p=_ack(ctx, text), ramble_p=_ramble(text, n_words, fillers, hedges),
        prev_text=prev.text.strip() if prev is not None else None,
    )


def _answered(f: _Feats) -> float:
    prev = f.prev_text
    if not prev:
        return 0.7
    if "?" not in prev and not rx.OTHER_REQUEST.search(prev):
        return 0.8
    if rx.DEFLECT.search(f.text):
        return 0.2
    if f.restarts >= 3:
        return 0.25
    if f.ramble_p >= 0.7:
        return 0.3
    if f.words <= 25 or rx.DIRECT_OPEN.match(f.text):
        return 0.82
    return 0.6


def _tone(f: _Feats) -> tuple[str, float]:
    nerves = f.hedges + 0.5 * f.fillers + 1.5 * f.restarts
    if rx.DEFENSIVE.search(f.text) and f.words > 4:
        return "defensive", 0.65
    if nerves >= 3:
        return "nervous", 0.65
    if f.words <= 4 and f.asked_p < 0.5 and f.ack_p < 0.5:
        return "flat", 0.6
    if rx.WARM.search(f.text) or (f.ack_p >= 0.7 and (f.asked_p >= 0.5 or "!" in f.text)):
        return "warm", 0.65
    if f.ack_p >= 0.7 or (f.asked_p >= 0.5 and "!" in f.text):
        return "warm", 0.5
    if nerves >= 2:
        return "nervous", 0.45
    return "confident", 0.55


def _clarity(f: _Feats) -> float:
    if f.words == 0:
        return 1.0
    score = 4.0
    clean = f.fillers == 0 and f.hedges == 0 and f.restarts == 0
    if clean and 5 <= f.words <= 60 and f.ramble_p < 0.3:
        score += 1.0
    score -= min(1.5, 0.25 * f.fillers)
    score -= min(2.0, 0.5 * f.hedges)
    score -= min(2.0, 0.6 * f.restarts)
    score -= 2.2 * max(0.0, f.ramble_p - 0.2)
    return round(min(5.0, max(1.0, score)), 2)


def _commitment(text: str) -> float:
    best = 0.05
    for s in rx.sentences(text):
        m = rx.FUTURE_SELF.search(s)
        if m is None:
            continue
        tail = s[m.start():]
        if rx.SOFTENER.search(s):
            best = max(best, 0.1)
            continue
        if not rx.ACTION.search(tail):
            continue
        concrete = rx.TIME.search(tail) or rx.OWNER.search(tail)
        best = max(best, 0.9 if concrete else 0.3)
    return best


# ---------- coach answers ----------
def _coach_answer(key: str, q: CoachQuestion, ctx: TurnContext) -> JudgeAnswer:
    known = COACH_RULES.get(key)
    if known is None or known[0] != q.type:
        return _neutral(q)
    if isinstance(q, ChoiceQuestion) and set(q.criteria) != set(STRATEGIES):
        return _neutral(q)
    return known[1](ctx)



def _neutral(q: CoachQuestion) -> JudgeAnswer:
    if isinstance(q, ChoiceQuestion):
        keys = tuple(q.criteria) or ("none",)
        share = 1.0 / len(keys)
        return ChoiceAnswer(choice=keys[0], probabilities={k: share for k in keys}, confidence=share)
    if q.type == "score":
        n = max(1, len(q.criteria))
        return ScoreAnswer(score=(n + 1) / 2, max=n, confidence=0.2)
    return NoulAnswer(p=0.5, confidence=0.5)


def rule_judge(ctx: TurnContext, coach: CoachSpec) -> dict[str, JudgeAnswer]:
    """Cheap regex/timing judge. Answers every core question plus neutral coach extras."""
    f = _features(ctx)
    tone, tone_p = _tone(f)
    qtop = 0.85 if f.qtype == "none" else (0.75 if f.asked_p >= 0.8 else 0.55)
    results: dict[str, JudgeAnswer] = {
        "interrupted": _noul(_interrupted(ctx)),
        "asked_question": _noul(f.asked_p),
        "question_type": _choice(QTYPES, f.qtype, qtop),
        "answered_the_question": _noul(_answered(f)),
        "hedging": _noul(HEDGE_P[min(3, f.hedges)]),
        "rambling": _noul(f.ramble_p),
        "acknowledged": _noul(f.ack_p),
        "tone": _choice(TONES, tone, tone_p),
        "clarity": ScoreAnswer(score=_clarity(f), max=5, confidence=0.5),
        "commitment_made": _noul(_commitment(f.text)),
    }
    for key, q in coach.questions.items():
        if key not in CORE_QUESTION_IDS:
            results[key] = _coach_answer(key, q, ctx)
    return results
