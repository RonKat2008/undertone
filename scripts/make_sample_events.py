"""Build fixtures/sample_conversation.jsonl: a fake 60 s conversation as Person A's events, made
by the real turn assembler and motion classifier, so B and C can build before the band works.

Each line: {"at": seconds_since_session_start, "event": <contract event>}. Replay in order,
sleeping until `at`.

    python3 scripts/make_sample_events.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.motion.classifier import MotionClassifier, synth_samples  # noqa: E402
from backend.stt.turns import NovaTurnAssembler, SpeakerMapper, Word  # noqa: E402

SCRIPT = [  # (speaker label, gap after the previous turn in s (negative = interrupts), text). Label 0 = wearer.
    (0, 0.5, "Hey thanks for meeting with me, um, I wanted to talk about the internship."),
    (1, 0.6, "Sure, happy to. What are you curious about?"),
    (0, 0.5, "So basically I've been building a lot of stuff, um, like an iOS app and a drone project and "
             "you know a bunch of hackathon things, and I mean I think I'm a good fit because I build fast "
             "and I, uh, I really like robotics and I've been doing this since high school basically."),
    (1, -2.0, "That's great. Wait, can I ask"),
    (0, 0.3, "And also the drone startup, we pivoted twice, um, which taught me a lot."),
    (1, 0.7, "Got it. Our team does mostly perception work on the arm."),
    (0, 0.8, "What does a normal week look like for an intern on the perception team?"),
    (1, 0.6, "You'd own one model end to end, ship it to the robot, and present it at the end of summer."),
    (0, 0.7, "That sounds amazing. Can I send you my resume after this?"),
    (1, 0.5, "Yes, send it over."),
]


def words_for(label, start, text, wps=2.9):
    out, t = [], start
    for w in text.split():
        d = 0.18 + 0.03 * len(w)
        out.append(Word(w, round(t, 2), round(t + d, 2), label))
        t += 1 / wps
    return out


def main():
    lines = []
    mapper = SpeakerMapper()
    turns = []
    asm = NovaTurnAssembler(mapper, turns.append, gap_s=1.2)
    all_words, t_end = [], 0.0
    for label, gap, text in SCRIPT:
        ws = words_for(label, t_end + gap, text)
        if gap < 0:  # interrupted: the wearer stops talking when the other person cuts in
            cut = ws[0].start
            all_words = [w for w in all_words if w.start < cut]
        all_words += ws
        t_end = ws[-1].end
        # a partial halfway through each turn, for the caption line
        half = ws[: max(1, len(ws) // 2)]
        lines.append({"at": half[-1].end, "event": {"type": "transcript.partial",
                                                    "speaker": "me" if label == 0 else "other",
                                                    "text": " ".join(w.text for w in half)}})
    asm.add(sorted(all_words, key=lambda w: w.start))
    asm.flush()
    total = t_end
    for t in turns:
        lines.append({"at": t["end"] + 0.4, "event": t})
    # motion: gesture while wearer talks, fidget during the long listen, still otherwise
    kind_for = {"me": "gesture", "other": "fidget"}
    segments, prev = [], 0.0
    for t in turns:
        if t["start"] > prev:
            segments.append(("still", prev, t["start"]))
        segments.append((kind_for[t["speaker"]], max(prev, t["start"]), t["end"]))
        prev = max(prev, t["end"])
    segments.append(("still", prev, prev + 3))
    c = MotionClassifier()
    spk_at = lambda ts: next((t["speaker"] for t in turns if t["start"] <= ts <= t["end"]), None)
    for kind, a, b in segments:
        for s in synth_samples(kind, b - a, t0=a, seed=int(a)):
            o = c.add(s)
            if o:
                lines.append({"at": o["ts"], "event": {"type": "motion", "state": o["state"],
                                                       "hand_energy": o["hand_energy"],
                                                       "speaker_context": spk_at(o["ts"]),
                                                       "confidence": o["confidence"], "ts": o["ts"]}})
    lines.append({"at": 18.0, "event": {"type": "bookmark", "source": "phone", "text": None, "ts": 18.0}})
    lines.append({"at": 42.0, "event": {"type": "status.reply", "verdict": "talking_too_much",
                                        "haptic": "status_talking", "ts": 42.0}})
    lines.sort(key=lambda x: x["at"])
    start = [{"at": 0, "event": {"type": "band.status", "connected": True, "transport": "sim",
                                 "battery_pct": 87, "mic_on": True}},
             {"at": 0, "event": {"type": "session.started", "session_id": "s_sample", "coach_id": "listener",
                                 "mode": "regular", "policy": {"focus_rule_id": "monologue",
                                                               "budget_per_session": 5, "min_gap_s": 60,
                                                               "tolerance": 0.3, "silent": False}, "ts": 0}}]
    end = [{"at": round(prev + 3.5, 2), "event": {"type": "session.ended", "session_id": "s_sample"}}]
    out = ROOT / "fixtures" / "sample_conversation.jsonl"
    out.parent.mkdir(exist_ok=True)
    out.write_text("\n".join(json.dumps(l) for l in start + lines + end) + "\n")
    print("wrote %s: %d events, %d turns" % (out.relative_to(ROOT), len(start + lines + end), len(turns)))


if __name__ == "__main__":
    main()
