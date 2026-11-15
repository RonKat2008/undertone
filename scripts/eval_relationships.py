"""Eval: synthetic two-person conversations (backend/relationships/examples.py) through the
Gemini Decisions path and the rules-only path. Prints expected vs got, accuracy, latency, calls.

Usage: uv run --env-file .env python scripts/eval_relationships.py [--rules-only] [--ids boss,friend] [--holdout]
       [--timeout 30]
An expected `unknown` also passes when the answer has confidence below LOW_CONFIDENCE.
Never prints transcript text or the API key. Always exits 0 (it is a report).
"""

from __future__ import annotations

import argparse
import asyncio
import statistics
import sys
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.config import settings  # noqa: E402
from backend.contracts import Relationship  # noqa: E402
from backend.judge import decisions  # noqa: E402
from backend.relationships import examples as ex  # noqa: E402
from backend.relationships._infer import infer  # noqa: E402
from backend.relationships._sample import sample_from  # noqa: E402

LOW_CONFIDENCE = 0.4


def passed(expected: str, got: Relationship) -> bool:
    if expected == "unknown":
        return got.kind == "unknown" or got.confidence < LOW_CONFIDENCE
    return got.kind == expected


class Counting:
    """Wraps decisions.decide to count API calls."""

    def __init__(self) -> None:
        self.calls = 0

    async def __call__(self, *args: Any, **kwargs: Any) -> Any:
        self.calls += 1
        return await decisions.decide(*args, **kwargs)


async def run(path: str, cases: list[tuple[str, str, ex.Lines]], timeout_s: float) -> list[dict[str, Any]]:
    out = []
    for cid, expected, lines in cases:
        counter = Counting()
        sample = sample_from(cid, [ex.turns(lines)])
        t0 = time.perf_counter()
        got = await infer(sample, decide=counter, rules_only=path == "rules", timeout_s=timeout_s)
        ms = (time.perf_counter() - t0) * 1000
        out.append({"id": cid, "expected": expected, "got": got, "ms": ms, "calls": counter.calls,
                    "ok": passed(expected, got)})
    return out


def report(path: str, rows: list[dict[str, Any]]) -> None:
    print(f"\n== {path} ==")
    print(f"{'case':<18} {'expected':<13} {'got':<13} {'conf':>5} {'src':<9} {'power':<9} {'form':<8} "
          f"{'ms':>6}  ok  evidence")
    for r in rows:
        g: Relationship = r["got"]
        print(f"{r['id']:<18} {r['expected']:<13} {g.kind:<13} {g.confidence:>5.2f} {g.source:<9} "
              f"{g.power:<9} {g.formality:<8} {r['ms']:>6.0f}  {'Y' if r['ok'] else '-'}   "
              f"{'; '.join(g.evidence)}")
    n_ok = sum(r["ok"] for r in rows)
    lat = [r["ms"] for r in rows if r["calls"]]
    print(f"accuracy {n_ok}/{len(rows)} = {n_ok / len(rows):.0%}; API calls {sum(r['calls'] for r in rows)} "
          f"({sum(r['calls'] for r in rows) / len(rows):.1f} per person)")
    if lat:
        print(f"latency ms: median {statistics.median(lat):.0f}, max {max(lat):.0f}, min {min(lat):.0f}")
    fell_back = [r["id"] for r in rows if path == "decisions" and r["got"].source != "decisions"]
    if fell_back:
        print(f"fell back to rules: {', '.join(fell_back)}")


async def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--rules-only", action="store_true")
    p.add_argument("--ids", default="", help="comma-separated case ids")
    p.add_argument("--timeout", type=float, default=30.0)
    p.add_argument("--holdout", action="store_true", help="also run the held-out cases (never tuned on)")
    args = p.parse_args()
    wanted = {i for i in args.ids.split(",") if i}
    pool = [*ex.CASES, *(ex.HOLDOUT if args.holdout else ())]
    cases = [c for c in pool if not wanted or c[0] in wanted]
    report("rules", await run("rules", cases, args.timeout))
    if args.rules_only:
        return
    if not settings.has_gemini:
        print("\nGEMINI_API_KEY not set: Decisions path skipped")
        return
    report("decisions", await run("decisions", cases, args.timeout))


if __name__ == "__main__":
    asyncio.run(main())
