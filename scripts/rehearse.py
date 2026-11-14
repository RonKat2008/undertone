"""Rehearse the whole stage demo offline: no band, no Deepgram, no Gemini needed.

    uv run python scripts/rehearse.py              # real time, like on stage
    uv run python scripts/rehearse.py --speed 3    # faster (time-based metrics get less exact)

Runs the real Brain, nudge engine, debrief and practice watcher in-process, with scripted
speech (STT=fake) on the simulated band, and prints what the audience would see:

  1. Regular conversation  (fixtures/demo_regular.jsonl, or --regular another.jsonl)
     + one single tap "How am I doing?", then the debrief.
  2. Practice round 1      (fixtures/demo_practice_round1.jsonl): a buzz per crutch word.
  3. Practice round 2      (fixtures/demo_practice_round2.jsonl): fewer, "5 -> 2".

Exit code 1 if a step that the demo relies on did not happen.
"""
import argparse
import asyncio
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def setup_env(speed: float) -> None:
    tmp = Path(tempfile.mkdtemp(prefix="undertone-rehearse-"))
    os.environ.update({
        "BAND_TRANSPORT": "sim", "STT": "fake", "STT_FAKE_SPEED": str(speed), "KEYBOARD_TAPS": "0",
        "DEMO_POLICY": os.environ.get("DEMO_POLICY", "1"), "UNDERTONE_DB": str(tmp / "rehearse.db"),
        "BAND_STATUS_EVERY_S": "0",
    })
    os.environ.setdefault("UNDERTONE_DATA", str(tmp))


def loop_time() -> float:
    return asyncio.get_running_loop().time()


def fast_answer_done(seen) -> bool:
    """True once a wearer turn has ended after the first slow_down nudge."""
    buzzed = False
    for ev in seen:
        if ev.type == "nudge" and ev.haptic == "slow_down":
            buzzed = True
        elif buzzed and ev.type == "turn.final" and ev.speaker == "me":
            return True
    return False


async def run(a) -> int:
    from backend import haptics_port, studio
    from backend.brain import Brain
    from backend.bus import Bus
    from backend.config import settings
    from backend.db import DB
    from backend.session import attach_band
    from backend.state import AppState

    buzzes = []

    async def phone(cmd):
        buzzes.append(cmd.pattern)
        print("    📳 phone buzz: %-14s %s" % (cmd.pattern, cmd.label))

    haptics_port.register_sender(phone)
    db = DB(os.environ["UNDERTONE_DB"])
    state = AppState(bus=Bus(), db=db, active_coach=studio.default_coach())
    brain = Brain(state, settings)
    seen = []

    async def watch(ev):
        seen.append(ev)
        if ev.type == "turn.final":
            who = "YOU " if ev.speaker == "me" else "THEM"
            print("  %s %5.1fs  %s%s" % (who, ev.start, ev.text[:70], "  [%s]" % ", ".join(ev.fillers) if ev.fillers else ""))
        elif ev.type == "nudge":
            print("    → nudge %-14s %s (%s, %d ms)" % (ev.rule_id, ev.message, ev.reason, ev.latency_ms))
        elif ev.type == "status.reply":
            print("    → How am I doing? %s" % ev.verdict)

    state.bus.on("*", watch)
    band = await attach_band(state, brain)
    ok = True

    def duration(path):
        from backend.stt.fake import load_turns
        return max(t[2] for t in load_turns(Path(path))) / a.speed + 1.5

    # 1. regular
    print("\n1. Regular conversation (%s)" % Path(a.regular).name)
    os.environ["STT_FAKE_SCRIPT"] = a.regular
    await brain.start_session()
    d = duration(a.regular)
    t_start = loop_time()
    # plan.md section 9: the tap comes after the fast answer that drew the pace buzz, and should
    # answer "talking too much". Tap on the first wearer turn that ends after a slow_down nudge.
    while loop_time() - t_start < d * 0.9 and not fast_answer_done(seen):
        await asyncio.sleep(0.1)
    reply = await brain.single_tap()
    await asyncio.sleep(max(0.0, d - (loop_time() - t_start)))
    await brain.end_session()
    for _ in range(40):
        await asyncio.sleep(0.25)
        if any(e.type == "debrief" for e in seen):
            break
    deb = next((e for e in seen if e.type == "debrief"), None)
    live = [e for e in seen if e.type == "nudge"]
    if deb:
        print("  DEBRIEF  %s\n           %s\n           %s\n           %s" % (
            deb.data.headline_fact, deb.data.strength, deb.data.one_fix, deb.data.if_then))
    ok &= deb is not None
    print("  live nudges: %s" % ([n.haptic for n in live] or "none"))
    ok &= any(n.haptic == "slow_down" for n in live)
    verdict = reply.verdict if reply is not None else None
    print("  tap after the fast answer: %s (demo script expects talking_too_much)" % verdict)
    ok &= verdict == "talking_too_much"

    # 2 + 3. practice rounds
    counts = []
    for i, path in enumerate([a.round1, a.round2], 1):
        print("\n%d. Practice round %d (%s)" % (i + 1, i, Path(path).name))
        os.environ["STT_FAKE_SCRIPT"] = path
        before = len(seen)
        await brain.start_session(mode="practice")
        await asyncio.sleep(duration(path))
        await brain.end_session()
        await asyncio.sleep(0.5)
        n = len([e for e in seen[before:] if e.type == "nudge" and e.rule_id == "crutch"])
        counts.append(n)
        print("  round score: %d crutch words" % n)
    print("\n  practice: %s" % " → ".join(str(c) for c in counts))
    ok &= counts[0] > 0 and counts[1] < counts[0]

    await state.bus.drain()
    await band.shutdown()
    haptics_port.reset_sender()
    db.close()
    print("\n%s" % ("REHEARSAL OK" if ok else "REHEARSAL: something the demo needs did not happen"))
    return 0 if ok else 1


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--speed", type=float, default=1.0)
    p.add_argument("--regular", default=str(ROOT / "fixtures" / "demo_regular.jsonl"))
    p.add_argument("--round1", default=str(ROOT / "fixtures" / "demo_practice_round1.jsonl"))
    p.add_argument("--round2", default=str(ROOT / "fixtures" / "demo_practice_round2.jsonl"))
    a = p.parse_args()
    setup_env(a.speed)
    return asyncio.run(run(a))


if __name__ == "__main__":
    sys.exit(main())
