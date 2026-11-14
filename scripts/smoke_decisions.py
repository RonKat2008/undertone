"""Smoke test: one real Gemini Decisions API call with the ten Core Coach questions.

Usage: uv run python scripts/smoke_decisions.py [--calls 3] [--rest]
Prints latency per call and the full structure of one answer of each type.
Never prints the API key.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.config import settings  # noqa: E402
from backend.judge.core_questions import CORE_QUESTIONS  # noqa: E402

INPUT = (
    "OTHER PERSON (previous turn, 0.0-6.2 s): So the client is a regional coffee chain, profits "
    "fell twenty percent over two years. How would you approach figuring out why, and what's the "
    "second thing I'd want you to—\n"
    "WEARER (turn being judged, 5.6-19.0 s): Um, so, like, I think maybe I'd basically start with "
    "revenue versus costs, sort of? I'm not totally sure but it could be costs. How does the client "
    "define success for this turnaround? And I'll send you the deck tonight.\n"
    "OVERLAP: the wearer started 0.6 s before the other person finished.\n"
    "MOTION: wearer fidgeted while the other person spoke; gestured while speaking."
)


def questions_payload() -> dict[str, dict]:
    return {k: q.model_dump() for k, q in CORE_QUESTIONS.items()}


def run_sdk(calls: int) -> None:
    from google import genai

    client = genai.Client(api_key=settings.gemini_api_key, http_options={"api_version": "v1beta"})
    qs = questions_payload()
    last = None
    for i in range(calls):
        t0 = time.perf_counter()
        last = client.decisions.create(model="gemini-decision-1", input=INPUT, questions=qs)
        print(f"call {i + 1}: {(time.perf_counter() - t0) * 1000:.0f} ms")
    assert last is not None
    print("response type:", type(last).__name__, "attrs:", sorted(type(last).model_fields))
    print("usage:", last.usage)
    print("prompt_feedback:", last.prompt_feedback)
    seen: set[str] = set()
    for key, ans in (last.answers or {}).items():
        print(f"  {key}: {ans!r}")
        t = getattr(ans, "type", "?")
        if t not in seen:
            seen.add(t)
            print(f"--- full structure of a '{t}' answer ({key}) ---")
            print(json.dumps(ans.model_dump(), indent=2))


def run_rest(calls: int) -> None:
    import httpx

    url = "https://generativelanguage.googleapis.com/v1beta/decisions"
    body = {"model": "gemini-decision-1", "input": INPUT, "questions": questions_payload()}
    headers = {"x-goog-api-key": settings.gemini_api_key or "", "content-type": "application/json"}
    with httpx.Client(timeout=30) as http:
        for i in range(calls):
            t0 = time.perf_counter()
            r = http.post(url, json=body, headers=headers)
            print(f"REST call {i + 1}: HTTP {r.status_code} in {(time.perf_counter() - t0) * 1000:.0f} ms")
        print(r.text[:4000])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--calls", type=int, default=3)
    ap.add_argument("--rest", action="store_true", help="use raw REST via httpx instead of the SDK")
    args = ap.parse_args()
    if not settings.has_gemini:
        sys.exit("GEMINI_API_KEY missing (set it in .env or UNDERTONE_ENV_FILE)")
    (run_rest if args.rest else run_sdk)(args.calls)


if __name__ == "__main__":
    main()
