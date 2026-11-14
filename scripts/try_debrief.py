"""Generate a real debrief for the demo fixture and print it (plan.md 4.6).

Usage: UNDERTONE_ENV_FILE=/path/to/.env uv run python scripts/try_debrief.py [--last] [--speak]
Never prints API keys.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.contracts import (  # noqa: E402
    BookmarkEvent, ChoiceAnswer, CoachSpec, Debrief, DebriefNumbers, JudgeEvent, Metrics, MotionEvent,
    NoulAnswer, NudgeEvent, ScoreAnswer, SessionSummary, TimelinePoint, TurnFinalEvent,
)
from backend.state import SessionState  # noqa: E402

FIXTURE = ROOT / "fixtures" / "demo_session.jsonl"
COACH = ROOT / "backend" / "studio" / "prebuilt" / "interview.json"


def _noul(p: float) -> NoulAnswer:
    return NoulAnswer(p=p, confidence=0.9)


def _judges() -> dict[str, JudgeEvent]:
    none_q = ChoiceAnswer(choice="none", probabilities={"none": 0.9}, confidence=0.9)
    open_q = ChoiceAnswer(choice="open", probabilities={"open": 0.9}, confidence=0.9)
    closed_q = ChoiceAnswer(choice="closed", probabilities={"closed": 0.85}, confidence=0.85)
    results: dict[str, dict] = {
        "t02": {"asked_question": _noul(0.95), "question_type": closed_q, "hedging": _noul(0.2)},
        "t04": {"hedging": _noul(0.93), "rambling": _noul(0.9), "clarity": ScoreAnswer(score=1, max=4, confidence=0.8),
                "question_type": none_q, "vague_quantity": _noul(0.85),
                "bottom_line_first": ScoreAnswer(score=1, max=5, confidence=0.8)},
        "t06": {"asked_question": _noul(0.95), "question_type": open_q, "hedging": _noul(0.05),
                "asked_clarifying": _noul(0.9)},
        "t08": {"commitment_made": _noul(0.92), "hedging": _noul(0.1)},
    }
    return {tid: JudgeEvent(turn_id=tid, results=r, latency_ms=900, source="decisions") for tid, r in results.items()}


def build_demo() -> tuple[SessionState, Metrics, list[TimelinePoint]]:
    """SessionState for the demo fixture, plus metrics and a short timeline."""
    coach = CoachSpec.model_validate(json.loads(COACH.read_text()))
    session = SessionState(session_id="demo-try", coach=coach, mode="regular", policy=coach.nudge_policy)
    for line in FIXTURE.read_text().splitlines():
        if not line.strip():
            continue
        row = json.loads(line)
        row.pop("at", None)
        if row["type"] == "turn.final":
            session.turns.append(TurnFinalEvent.model_validate(row))
        elif row["type"] == "motion":
            session.motion.append(MotionEvent.model_validate(row))
    session.judge_results = _judges()
    session.nudges.append(NudgeEvent(rule_id="hedging", haptic="filler", message="Say it plainly",
                                     reason="judge.hedging.p 0.93 >= 0.8", confidence=0.93,
                                     latency_ms=1400, budget_left=4, ts=45.0))
    session.bookmarks.extend([BookmarkEvent(source="phone", ts=46.0),
                              BookmarkEvent(source="promise", text="Send the deck tonight", ts=86.0)])
    session.ended_at = session.started_at + 92.0
    metrics = Metrics(talk_ratio=0.68, interruptions=2, questions=2, fillers_per_min=7.5, wpm=171,
                      monologue_s=0.0, volume_db=-22.5, hand_energy=0.5)
    timeline = [TimelinePoint(t=t, wpm=w, volume_db=v, hand_energy=h) for t, w, v, h in
                [(0, 0, -60, 0.62), (15, 152, -23.5, 0.49), (30, 181, -21.4, 0.55),
                 (45, 183, -21.6, 0.57), (60, 174, -22.9, 0.46), (75, 154, -22.0, 0.42)]]
    return session, metrics, timeline


def demo_last() -> SessionSummary:
    return SessionSummary(
        session_id="demo-prev", started_at="2026-11-13T18:00:00+00:00", duration_s=140.0,
        coach_name="Interview", mode="regular",
        headline_fact="Your market-sizing answer ran 71 seconds and you said \"I'm not sure\" four times.",
        numbers=DebriefNumbers(talk_ratio=0.72, interruptions=2, questions=1, fillers_per_min=9.1, wpm=176),
    )


def _spoken(debrief: Debrief) -> str:
    try:
        from backend.debrief.speech import spoken_text
    except ImportError:
        return " ".join([debrief.headline_fact, debrief.strength, debrief.one_fix, debrief.if_then])
    return spoken_text(debrief)


async def run(with_last: bool, do_speak: bool) -> int:
    from backend.debrief.generate import generate_with_info

    session, metrics, timeline = build_demo()
    last = demo_last() if with_last else None
    debrief, info = await generate_with_info(session, metrics, timeline, last)
    print(json.dumps(debrief.model_dump(mode="json", exclude={"timeline"}), indent=2))
    print("\nINFO:", json.dumps(info, indent=2))
    text = _spoken(debrief)
    print(f"\nSPOKEN ({len(text.split())} words):\n{text}")
    if do_speak:
        try:
            from backend.debrief.speech import speak
        except ImportError:
            print("\nspeak: backend.debrief.speech not available")
            return 0
        started = time.perf_counter()
        url = await speak(text, session.session_id)
        print(f"\nAUDIO: {url} ({time.perf_counter() - started:.2f}s)")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--last", action="store_true", help="include a plausible past session")
    parser.add_argument("--speak", action="store_true", help="synthesize the spoken recap")
    args = parser.parse_args()
    logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(name)s: %(message)s")
    return asyncio.run(run(args.last, args.speak))


if __name__ == "__main__":
    raise SystemExit(main())
