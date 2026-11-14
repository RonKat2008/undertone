"""Eval: run fixtures/judge_cases.jsonl through the rule judge and the Gemini Decisions judge.

Usage: uv run python scripts/eval_judge.py [--rules-only] [--limit N] [--ids j01,j05]
       [--gap 0.5] [--interval 2.0] [--timeout 10.0] [--json PATH]
Prints per-question accuracy for both judges, the misses, and Decisions latency stats.
Always exits 0 (it is a report). Never prints the API key.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import statistics
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.config import settings  # noqa: E402
from backend.contracts import (  # noqa: E402
    ChoiceAnswer, CoachSpec, NoulAnswer, ScoreAnswer, TurnContext, TurnFinalEvent,
)
from backend.judge import format_input, rule_judge  # noqa: E402
from backend.studio import default_coach  # noqa: E402

CASES_PATH = ROOT / "fixtures" / "judge_cases.jsonl"
FILLER_RE = re.compile(r"\b(um|uh|erm|er)\b", re.I)
WPM = 150.0
WORDS_PER_S = 2.5
PREV_END_S = 5.0
SCORE_TOL = 1.0
SCORE_EXACT_TOL = 0.5
RETRY_WAIT_S = 5.0
TEXT_W = 80

Answer = NoulAnswer | ChoiceAnswer | ScoreAnswer


@dataclass
class Result:
    answers: dict[str, dict[str, Answer]] = field(default_factory=dict)  # case id -> qid -> answer
    errors: dict[str, str] = field(default_factory=dict)  # case id -> error text
    latencies_ms: list[float] = field(default_factory=list)


def load_cases(limit: int | None, ids: set[str] | None) -> list[dict[str, Any]]:
    cases = [json.loads(line) for line in CASES_PATH.read_text().splitlines() if line.strip()]
    if ids:
        cases = [c for c in cases if c["id"] in ids]
    return cases[:limit] if limit else cases


def build_ctx(case: dict[str, Any], gap: float) -> TurnContext:
    prev: TurnFinalEvent | None = None
    if case.get("prev_other") is not None:
        prev = TurnFinalEvent(turn_id=f"{case['id']}-o", speaker="other", text=case["prev_other"],
                              start=0.0, end=PREV_END_S, wpm=WPM)
    text: str = case["me"]
    start = prev.end + gap if prev is not None else 0.0
    dur = max(1.0, len(text.split()) / WORDS_PER_S)
    turn = TurnFinalEvent(turn_id=case["id"], speaker="me", text=text, start=round(start, 2),
                          end=round(start + dur, 2), wpm=WPM,
                          fillers=[m.lower() for m in FILLER_RE.findall(text)])
    return TurnContext(turn=turn, prev_other_turn=prev, motion_summary=case.get("motion_summary") or "")


def clarity_1based(ans: ScoreAnswer) -> float:
    """Clarity has 5 levels. A max of 5 means a 1-based score; a max of 4 means 0-based (index)."""
    return ans.score if ans.max >= 5 else ans.score + 1.0


def is_correct(ans: Answer | None, expected: bool | str | int) -> bool:
    if ans is None:
        return False
    if isinstance(ans, NoulAnswer):
        return (ans.p >= 0.5) == bool(expected)
    if isinstance(ans, ChoiceAnswer):
        return ans.choice == expected
    return abs(clarity_1based(ans) - float(expected)) <= SCORE_TOL


def describe(ans: Answer | None) -> str:
    if ans is None:
        return "got=<missing>"
    if isinstance(ans, NoulAnswer):
        return f"got={ans.p >= 0.5} (p={ans.p:.2f})"
    if isinstance(ans, ChoiceAnswer):
        top = sorted(ans.probabilities.items(), key=lambda kv: -kv[1])[:3]
        return f"got={ans.choice} ({', '.join(f'{k}={v:.2f}' for k, v in top)})"
    return f"got={clarity_1based(ans):.1f} (raw={ans.score:.2f}/max={ans.max:g})"


def run_rules(cases: list[dict[str, Any]], coach: CoachSpec, gap: float) -> Result:
    res = Result()
    for c in cases:
        res.answers[c["id"]] = rule_judge(build_ctx(c, gap), coach)
    return res


async def run_decisions(cases: list[dict[str, Any]], coach: CoachSpec, args: argparse.Namespace) -> Result:
    from backend.judge.decisions import DecisionsUnavailable, decide, merge_questions, warm_up

    res = Result()
    questions = merge_questions(coach)
    ok = await warm_up()
    print(f"warm_up: {'ok' if ok else 'failed (continuing)'}")
    next_start = time.perf_counter()
    for i, c in enumerate(cases):
        text = format_input(build_ctx(c, args.gap))
        for attempt in (1, 2):
            await asyncio.sleep(max(0.0, next_start - time.perf_counter()))
            next_start = time.perf_counter() + args.interval
            t0 = time.perf_counter()
            try:
                res.answers[c["id"]] = await decide(text, questions, timeout_s=args.timeout)
                res.latencies_ms.append((time.perf_counter() - t0) * 1000)
                break
            except DecisionsUnavailable as exc:
                if attempt == 2:
                    res.errors[c["id"]] = f"{type(exc).__name__}: {exc}"[:160]
                else:
                    await asyncio.sleep(RETRY_WAIT_S)
        print(f"  decisions {i + 1}/{len(cases)} {c['id']}: {'ok' if c['id'] in res.answers else 'ERROR'}",
              flush=True)
    return res


def score(cases: list[dict[str, Any]], res: Result) -> tuple[dict[str, list[int]], list[str]]:
    """Returns {qid: [correct, n]} (plus OVERALL) and the formatted miss lines."""
    tally: dict[str, list[int]] = {}
    misses: list[str] = []
    for c in cases:
        got = res.answers.get(c["id"], {})
        for qid, exp in c["expect"].items():
            t = tally.setdefault(qid, [0, 0])
            t[1] += 1
            ans = got.get(qid)
            if is_correct(ans, exp):
                t[0] += 1
            elif c["id"] not in res.errors:
                me = c["me"] if len(c["me"]) <= TEXT_W else c["me"][: TEXT_W - 3] + "..."
                misses.append(f"  {c['id']} {qid} expected={exp} {describe(ans)} | {me}")
    tally["OVERALL"] = [sum(v[0] for v in tally.values()), sum(v[1] for v in tally.values())]
    return tally, misses


def clarity_exact(cases: list[dict[str, Any]], res: Result) -> str:
    hits = n = 0
    for c in cases:
        if "clarity" not in c["expect"]:
            continue
        n += 1
        ans = res.answers.get(c["id"], {}).get("clarity")
        if isinstance(ans, ScoreAnswer) and abs(clarity_1based(ans) - c["expect"]["clarity"]) <= SCORE_EXACT_TOL:
            hits += 1
    return f"{hits}/{n}"


def pct(t: list[int] | None) -> str:
    if not t or t[1] == 0:
        return "-"
    return f"{t[0]}/{t[1]} {100 * t[0] / t[1]:5.1f}%"


def print_report(cases: list[dict[str, Any]], rules: Result, dec: Result | None) -> None:
    r_tally, r_miss = score(cases, rules)
    d_tally, d_miss = score(cases, dec) if dec else ({}, [])
    qids = [q for q in r_tally if q != "OVERALL"]
    print(f"\n{'question':<24}{'n':>4}  {'rules acc':>14}  {'decisions acc':>14}")
    print("-" * 60)
    for q in [*sorted(qids), "OVERALL"]:
        if q == "OVERALL":
            print("-" * 60)
        print(f"{q:<24}{r_tally[q][1]:>4}  {pct(r_tally[q]):>14}  {pct(d_tally.get(q)) if dec else '-':>14}")
    foot = f"rules {clarity_exact(cases, rules)}"
    if dec:
        foot += f", decisions {clarity_exact(cases, dec)}"
    print(f"\nclarity: correct = within {SCORE_TOL:g} of expected (1-based); "
          f"within {SCORE_EXACT_TOL:g}: {foot}")
    print(f"\nMISSES (rules): {len(r_miss)}")
    print("\n".join(r_miss) or "  none")
    if dec:
        print(f"\nMISSES (decisions): {len(d_miss)}")
        print("\n".join(d_miss) or "  none")
        print(f"\nERRORS (decisions, counted as misses): {len(dec.errors)}")
        for cid, err in dec.errors.items():
            print(f"  {cid}: {err}")
        print_latency(dec.latencies_ms)


def print_latency(lat: list[float]) -> None:
    if not lat:
        print("\nlatency: no successful calls")
        return
    s = sorted(lat)
    p90 = s[min(len(s) - 1, int(round(0.9 * (len(s) - 1))))]
    print(f"\nlatency ms (n={len(s)}): min {s[0]:.0f}  median {statistics.median(s):.0f}  "
          f"p90 {p90:.0f}  max {s[-1]:.0f}")


def dump_json(path: Path, cases: list[dict[str, Any]], rules: Result, dec: Result | None) -> None:
    def ser(res: Result | None, cid: str) -> dict[str, Any] | None:
        if res is None:
            return None
        if cid in res.errors:
            return {"error": res.errors[cid]}
        return {q: a.model_dump() for q, a in res.answers.get(cid, {}).items()}

    out = [{"id": c["id"], "expect": c["expect"], "rules": ser(rules, c["id"]),
            "decisions": ser(dec, c["id"])} for c in cases]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out, indent=2))
    print(f"\nwrote {path}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--rules-only", action="store_true", help="skip the Decisions API (no network)")
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--ids", type=str, default="", help="comma-separated case ids, e.g. j01,j05")
    ap.add_argument("--gap", type=float, default=0.5, help="seconds between other turn end and wearer start")
    ap.add_argument("--interval", type=float, default=2.0, help="seconds between Decisions call starts")
    ap.add_argument("--timeout", type=float, default=10.0, help="per-call Decisions timeout (s)")
    ap.add_argument("--json", type=Path, default=None, help="dump per-case answers as JSON")
    args = ap.parse_args()

    ids = {s.strip() for s in args.ids.split(",") if s.strip()} or None
    cases = load_cases(args.limit, ids)
    coach = default_coach()
    print(f"cases: {len(cases)}  coach: {coach.id}  gap: {args.gap}s")
    rules = run_rules(cases, coach, args.gap)
    dec: Result | None = None
    if not args.rules_only:
        if not settings.has_gemini:
            print("GEMINI_API_KEY missing: running the rule judge only.")
        else:
            try:
                dec = asyncio.run(run_decisions(cases, coach, args))
            except Exception as exc:  # report, never crash
                print(f"decisions run failed: {type(exc).__name__}: {str(exc)[:200]}")
    print_report(cases, rules, dec)
    if args.json:
        dump_json(args.json, cases, rules, dec)


if __name__ == "__main__":
    main()
    sys.exit(0)
