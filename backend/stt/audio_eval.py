"""Scoring the real speech pipeline against a ground-truth conversation (scripts/eval_audio.py).

Pure functions, no network: unit tested in backend/tests/test_audio_eval.py.

    truth  = [{"turn", "speaker", "text", "start", "end", "words", "wpm", "fillers"}, ...]
    turns  = turn.final events, each with "emitted_at" (session audio seconds when it arrived)
    words  = [(speaker, Word), ...] from Hearing.on_words, as emitted
    card   = score(truth, turns, words)
"""
from __future__ import annotations

import re
import statistics
from collections import Counter
from typing import Dict, List, Optional, Sequence, Tuple

_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen " \
        "sixteen seventeen eighteen nineteen".split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def number_words(n: int) -> List[str]:
    if n < 20:
        return [_ONES[n]]
    if n < 100:
        return [_TENS[n // 10]] + ([_ONES[n % 10]] if n % 10 else [])
    if n < 1000:
        return [_ONES[n // 100], "hundred"] + (number_words(n % 100) if n % 100 else [])
    if n < 1_000_000:
        return number_words(n // 1000) + ["thousand"] + (number_words(n % 1000) if n % 1000 else [])
    return [str(n)]


def norm_words(text: str) -> List[str]:
    """Lower case, no punctuation, digits spelt out ("20%" = "twenty percent"), hyphens split."""
    t = text.lower().replace("%", " percent ").replace("—", " ").replace("-", " ")
    out: List[str] = []
    for tok in re.findall(r"[a-z']+|\d+", t):
        if tok.isdigit():
            out += number_words(int(tok))
        else:
            tok = tok.strip("'")
            if tok:
                out.append(tok)
    return out


def edit_ops(ref: Sequence[str], hyp: Sequence[str]) -> Tuple[int, int, int]:
    """(substitutions, deletions, insertions) of the cheapest alignment."""
    n, m = len(ref), len(hyp)
    d = [[(0, 0, 0, 0)] * (m + 1) for _ in range(n + 1)]  # (cost, sub, del, ins)
    for i in range(1, n + 1):
        d[i][0] = (i, 0, i, 0)
    for j in range(1, m + 1):
        d[0][j] = (j, 0, 0, j)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            if ref[i - 1] == hyp[j - 1]:
                d[i][j] = d[i - 1][j - 1]
                continue
            c, s, de, ins = d[i - 1][j - 1]
            best = (c + 1, s + 1, de, ins)
            c, s, de, ins = d[i - 1][j]
            best = min(best, (c + 1, s, de + 1, ins))
            c, s, de, ins = d[i][j - 1]
            best = min(best, (c + 1, s, de, ins + 1))
            d[i][j] = best
    _, s, de, ins = d[n][m]
    return s, de, ins


def wer(ref: Sequence[str], hyp: Sequence[str]) -> float:
    if not ref:
        return 0.0 if not hyp else 1.0
    s, de, ins = edit_ops(ref, hyp)
    return (s + de + ins) / len(ref)


def _overlap(a0: float, a1: float, b0: float, b1: float) -> float:
    return max(0.0, min(a1, b1) - max(a0, b0))


def _owner(t: float, truth: Sequence[dict], pad: float = 0.25) -> Optional[int]:
    """Index of the one truth turn whose (padded) span holds time t; None if none or several."""
    hits = [i for i, g in enumerate(truth) if g["start"] - pad <= t <= g["end"] + pad]
    if len(hits) == 1:
        return hits[0]
    if len(hits) > 1:  # overlap: the turn whose middle is nearest
        return min(hits, key=lambda i: abs(t - (truth[i]["start"] + truth[i]["end"]) / 2))
    return None


def score(truth: Sequence[dict], turns: Sequence[dict], words: Sequence[Tuple[str, object]] = ()) -> dict:
    truth = sorted(truth, key=lambda g: g["start"])
    turns = sorted(turns, key=lambda e: e["start"])
    # ---- assign each detected turn to the truth turn it overlaps most
    assigned: Dict[int, List[dict]] = {i: [] for i in range(len(truth))}
    spurious = []
    merged = []
    for e in turns:
        ov = [_overlap(e["start"], e["end"], g["start"], g["end"]) for g in truth]
        best = max(range(len(truth)), key=lambda i: ov[i])
        if ov[best] <= 0:
            spurious.append(e["turn_id"])
            continue
        assigned[best].append(e)
        covered = [i for i, g in enumerate(truth)
                   if ov[i] >= min(0.5, 0.3 * (g["end"] - g["start"]))]
        if len(covered) > 1:
            merged.append({"turn_id": e["turn_id"], "truth_turns": [truth[i]["turn"] for i in covered]})
    per_turn = []
    lat = []
    for i, g in enumerate(truth):
        es = assigned[i]
        row = {"turn": g["turn"], "speaker": g["speaker"], "detected": [e["turn_id"] for e in es]}
        if es:
            main = max(es, key=lambda e: _overlap(e["start"], e["end"], g["start"], g["end"]))
            row["got_speaker"] = main["speaker"]
            row["speaker_ok"] = main["speaker"] == g["speaker"]
            got = [w for e in es for w in norm_words(e["text"])]
            row["wer"] = round(wer(norm_words(g["text"]), got), 3)
            row["start_err"] = round(es[0]["start"] - g["start"], 2)
            row["end_err"] = round(es[-1]["end"] - g["end"], 2)
            if all("emitted_at" in e for e in es):
                row["latency"] = round(es[-1]["emitted_at"] - g["end"], 2)
                lat.append(row["latency"])
            n_words = sum(len(e["text"].split()) for e in es)
            span = max(es[-1]["end"] - es[0]["start"], 0.5)
            row["wpm_truth"] = g["wpm"]
            row["wpm_got"] = es[0]["wpm"] if len(es) == 1 else round(n_words / span * 60, 1)
            row["wpm_err_pct"] = round(100 * (row["wpm_got"] - g["wpm"]) / g["wpm"], 1)
            row["fillers_truth"] = list(g.get("fillers", []))
            row["fillers_got"] = [f for e in es for f in e.get("fillers", [])]
        else:
            row["missed"] = True
            row["fillers_truth"] = list(g.get("fillers", []))
            row["fillers_got"] = []
        per_turn.append(row)
    # ---- words: who said each word, as emitted
    w_ok = w_tot = 0
    for spk, w in words:
        i = _owner((w.start + w.end) / 2, truth)
        if i is None:
            continue
        w_tot += 1
        w_ok += spk == truth[i]["speaker"]
    # ---- overall
    ref_all = [w for g in truth for w in norm_words(g["text"])]
    hyp_all = [w for e in turns for w in norm_words(e["text"])]
    s, de, ins = edit_ops(ref_all, hyp_all)
    me_truth = [g for g in truth if g["speaker"] == "me"]
    me_got = [e for e in turns if e["speaker"] == "me"]

    def pace(rows_words, rows_secs):
        secs = sum(rows_secs)
        return round(sum(rows_words) / secs * 60, 1) if secs > 0 else None

    wpm_truth = pace([g["words"] for g in me_truth], [g["end"] - g["start"] for g in me_truth])
    wpm_got = pace([len(e["text"].split()) for e in me_got], [max(e["end"] - e["start"], 0.5) for e in me_got])
    f_truth = Counter(f for g in truth for f in g.get("fillers", []))
    f_got = Counter(f for e in turns for f in e.get("fillers", []))
    judged = [r for r in per_turn if "speaker_ok" in r]
    wpm_errs = [abs(r["wpm_err_pct"]) for r in per_turn if r["speaker"] == "me" and "wpm_err_pct" in r]
    return {
        "turns_expected": len(truth),
        "turns_detected": len(turns),
        "missed": [r["turn"] for r in per_turn if r.get("missed")],
        "split": [{"turn": r["turn"], "into": r["detected"]} for r in per_turn if len(r["detected"]) > 1],
        "merged": merged,
        "spurious": spurious,
        "speaker_turn_acc": round(sum(r["speaker_ok"] for r in judged) / len(judged), 3) if judged else None,
        "wrong_speaker": [r["turn"] for r in judged if not r["speaker_ok"]],
        "speaker_word_acc": round(w_ok / w_tot, 3) if w_tot else None,
        "words_scored": w_tot,
        "wer": round((s + de + ins) / len(ref_all), 3) if ref_all else None,
        "wer_ops": {"sub": s, "del": de, "ins": ins, "ref_words": len(ref_all), "hyp_words": len(hyp_all)},
        "wearer_wpm_truth": wpm_truth,
        "wearer_wpm_got": wpm_got,
        "wearer_wpm_err_pct": round(100 * (wpm_got - wpm_truth) / wpm_truth, 1) if wpm_got and wpm_truth else None,
        "wearer_turn_wpm_abs_err_pct_median": round(statistics.median(wpm_errs), 1) if wpm_errs else None,
        "fillers_truth": dict(f_truth),
        "fillers_got": dict(f_got),
        "fillers_matched": sum((f_truth & f_got).values()),
        "fillers_truth_total": sum(f_truth.values()),
        "fillers_got_total": sum(f_got.values()),
        "latency_median": round(statistics.median(lat), 2) if lat else None,
        "latency_worst": round(max(lat), 2) if lat else None,
        "per_turn": per_turn,
    }


def format_card(card: dict, title: str = "") -> str:
    L = []
    if title:
        L.append("== %s ==" % title)
    L.append("turns            %d detected / %d expected   missed %s  split %s  merged %s  spurious %s" % (
        card["turns_detected"], card["turns_expected"], card["missed"] or "-",
        [s["turn"] for s in card["split"]] or "-", [m["truth_turns"] for m in card["merged"]] or "-",
        card["spurious"] or "-"))
    L.append("speaker (turns)  %s   wrong: %s" % (_pct(card["speaker_turn_acc"]), card["wrong_speaker"] or "-"))
    L.append("speaker (words)  %s of %d words" % (_pct(card["speaker_word_acc"]), card["words_scored"]))
    o = card["wer_ops"]
    L.append("WER              %s  (sub %d, del %d, ins %d; %d ref words, %d heard)" % (
        _pct(card["wer"]), o["sub"], o["del"], o["ins"], o["ref_words"], o["hyp_words"]))
    L.append("wearer pace      got %s wpm vs truth %s wpm (%s%%); median |per-turn error| %s%%" % (
        card["wearer_wpm_got"], card["wearer_wpm_truth"], card["wearer_wpm_err_pct"],
        card["wearer_turn_wpm_abs_err_pct_median"]))
    L.append("fillers          %d of %d scripted found, %d reported   truth %s   got %s" % (
        card["fillers_matched"], card["fillers_truth_total"], card["fillers_got_total"],
        card["fillers_truth"], card["fillers_got"]))
    L.append("latency          end of speech -> turn.final: median %ss, worst %ss" % (
        card["latency_median"], card["latency_worst"]))
    L.append("per turn:")
    for r in card["per_turn"]:
        if r.get("missed"):
            L.append("  %2d %-5s MISSED" % (r["turn"], r["speaker"]))
            continue
        L.append("  %2d %-5s -> %-11s %-5s wer %4.0f%%  start %+5.2f end %+5.2f  lat %5s  wpm %5.1f/%5.1f  fillers %d/%d" % (
            r["turn"], r["speaker"], ",".join(r["detected"]), r["got_speaker"] + ("" if r["speaker_ok"] else "!"),
            100 * r["wer"], r["start_err"], r["end_err"], r.get("latency", "?"), r["wpm_got"], r["wpm_truth"],
            len(r["fillers_got"]), len(r["fillers_truth"])))
    return "\n".join(L)


def _pct(x: Optional[float]) -> str:
    return "n/a" if x is None else "%.1f%%" % (100 * x)
