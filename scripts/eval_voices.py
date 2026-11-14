"""Evaluate voice memory on the labelled set built by scripts/voice_eval_data.py.

    uv run --env-file /Users/ronitkatikaneni/undertone/.env python scripts/eval_voices.py \
        [--data .undertone/voice_eval] [--model wespeaker-resnet34-lm] [--no-enrol] [--no-llm] [--json out.json]

Runs the real pipeline (backend/voices: real embedding model, temp database) over every
conversation in order, as if each had just closed, and reports:
  1. wearer-vs-other accuracy per stored turn and per word, before (stored labels) and after correction
  2. recognition of recurring people across conversations: correct links, wrong merges, wrong splits
  3. same- vs different-speaker cosine distributions (truth segments and conversation clusters),
     with the equal-error threshold
  4. name extraction precision / recall
  5. processing time (and a 2-minute conversation)
Never prints keys. Without GEMINI_API_KEY (or with --no-llm) names come from the rule fallback.
"""

from __future__ import annotations

import argparse
import asyncio
import itertools
import json
import logging
import os
import shutil
import sys
import tempfile
import time
import wave
from collections import Counter
from dataclasses import replace
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.capture.media import recordings_dir  # noqa: E402
from backend.contracts import Metrics, TurnFinalEvent  # noqa: E402
from backend.db import DB  # noqa: E402
from backend.voices import store  # noqa: E402
from backend.voices.audio import slice_seconds, voiced  # noqa: E402
from backend.voices.embedder import load_embedder  # noqa: E402
from backend.voices.names import other_name, rule_name  # noqa: E402
from backend.voices.process import read_wav  # noqa: E402
from backend.voices.prints import cosine, normalize  # noqa: E402
from backend.voices.service import VoiceMemory  # noqa: E402
from backend.voices.types import SAMPLE_RATE, TimedWord, VoiceConfig  # noqa: E402

log = logging.getLogger("eval_voices")


# ---------- data ----------
def load_set(data: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest = json.loads((data / "manifest.json").read_text())
    convs = [json.loads((data / c["files"]["truth"]).read_text()) | {"wav": str(data / c["files"]["wav"])}
             for c in manifest["conversations"]]
    return manifest, convs


def add_session(db: DB, sid: str, conv: dict[str, Any], minute: int) -> None:
    db.create_session(sid, "default", "Default", "regular", f"2026-11-14T{9 + minute // 60:02d}:{minute % 60:02d}:00+00:00")
    for t in conv["stored_turns"]:
        db.save_turn(sid, TurnFinalEvent.model_validate(t))
    db.end_session(sid, "2026-11-14T12:00:00+00:00", float(conv["duration_s"]), Metrics(), None)
    directory = recordings_dir(Path(db.path))
    directory.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(conv["wav"], directory / f"{sid}.wav")
    db.set_recording(sid, 0.0, float(conv["duration_s"]))
    db.set_verdict(sid, True, "keep", "rules")
    words = [TimedWord(w["text"], w["start"], w["end"], int(w["label"])) for w in conv["words"]]
    store.save_words(db, sid, words)


# ---------- 1. wearer vs other ----------
def _truth_at(conv: dict[str, Any], start: float, end: float) -> str | None:
    roles = Counter(w["truth_role"] for w in conv["words"] if start - 0.05 <= (w["start"] + w["end"]) / 2 <= end + 0.05)
    return roles.most_common(1)[0][0] if roles else None


def turn_accuracy(conv: dict[str, Any], turns: list[TurnFinalEvent]) -> tuple[int, int]:
    scored = [(t.speaker, _truth_at(conv, t.start, t.end)) for t in turns]
    scored = [(s, r) for s, r in scored if r is not None]
    return sum(s == r for s, r in scored), len(scored)


def word_accuracy(conv: dict[str, Any], turns: list[TurnFinalEvent]) -> tuple[int, int]:
    ok = 0
    for w in conv["words"]:
        mid = (w["start"] + w["end"]) / 2
        t = next((t for t in turns if t.start - 0.05 <= mid <= t.end + 0.05), None)
        ok += int(t is not None and t.speaker == w["truth_role"])
    return ok, len(conv["words"])


# ---------- 2. recognition ----------
def recognition(rows: list[tuple[str, str | None]]) -> dict[str, int]:
    """rows: (truth other key, voice id). Pairwise over conversations."""
    out = Counter()
    for (k1, v1), (k2, v2) in itertools.combinations(rows, 2):
        if k1 == k2:
            out["correct_link" if v1 is not None and v1 == v2 else "wrong_split"] += 1
        else:
            out["wrong_merge" if v1 is not None and v1 == v2 else "correct_apart"] += 1
    return dict(out)


# ---------- 3. similarity distributions ----------
def segment_embeddings(convs: list[dict[str, Any]], embedder: Any, crop_s: float | None) -> list[tuple[str, np.ndarray]]:
    out = []
    for conv in convs:
        audio = read_wav(Path(conv["wav"]))
        segs = conv["segments"]
        for i, seg in enumerate(segs):
            start, end = seg["start"], seg["end"]
            if i + 1 < len(segs):
                end = min(end, segs[i + 1]["start"])  # drop overlap
            if i > 0:
                start = max(start, segs[i - 1]["end"])
            x = voiced(slice_seconds(audio, start, end))
            if crop_s is not None:
                x = x[: int(crop_s * SAMPLE_RATE)]
                if len(x) < int(crop_s * SAMPLE_RATE) * 0.95:
                    continue
            if len(x) < SAMPLE_RATE * 0.5:
                continue
            out.append((seg["speaker_key"], normalize(embedder.embed(x[: 6 * SAMPLE_RATE]))))
    return out


def distributions(items: list[tuple[str, np.ndarray]]) -> dict[str, Any]:
    same, diff = [], []
    for (k1, e1), (k2, e2) in itertools.combinations(items, 2):
        (same if k1 == k2 else diff).append(cosine(e1, e2))
    return {"same": summary(same), "different": summary(diff), "eer": eer(same, diff), "n": len(items)}


def summary(xs: list[float]) -> dict[str, float]:
    if not xs:
        return {}
    a = np.asarray(xs)
    return {"mean": round(float(a.mean()), 3), "std": round(float(a.std()), 3), "min": round(float(a.min()), 3),
            "p5": round(float(np.percentile(a, 5)), 3), "p95": round(float(np.percentile(a, 95)), 3),
            "max": round(float(a.max()), 3), "pairs": len(xs)}


def eer(same: list[float], diff: list[float]) -> dict[str, float]:
    if not same or not diff:
        return {}
    s, d = np.asarray(same), np.asarray(diff)
    best = min(((abs((s < t).mean() - (d >= t).mean()), t) for t in np.linspace(-0.2, 1.0, 241)))
    t = best[1]
    return {"threshold": round(float(t), 3), "frr": round(float((s < t).mean()), 3),
            "far": round(float((d >= t).mean()), 3)}


def cluster_items(db: DB, sids: dict[str, dict[str, Any]]) -> list[tuple[str, np.ndarray]]:
    """Every stored conversation cluster centroid (sightings), labelled by the truth speaker."""
    out = []
    for sid, conv in sids.items():
        for s in store.sightings_for_session(db, sid):
            if s.embedding is not None:
                out.append((conv["wearer_key"] if s.role == "me" else conv["other_key"], s.embedding))
    return out


# ---------- run ----------
def namer(use_llm: bool):  # type: ignore[no-untyped-def]
    async def rules_only(turns, wearer_name=None):  # type: ignore[no-untyped-def]
        return rule_name(turns, wearer_name)
    return other_name if use_llm else rules_only


async def run(args: argparse.Namespace) -> dict[str, Any]:
    manifest, convs = load_set(Path(args.data))
    if args.model:
        os.environ["VOICE_MODEL"] = args.model
    embedder = load_embedder(download=True)
    if embedder is None:
        raise SystemExit("embedding model unavailable")
    tmp = Path(tempfile.mkdtemp(prefix="eval-voices-"))
    db = DB(tmp / "eval.db")
    cfg = replace(VoiceConfig(), **{k: v for k, v in (args.cfg or {}).items()})
    vm = VoiceMemory(db, cfg=cfg, enabled=True, embedder_factory=lambda: embedder, namer=namer(not args.no_llm))
    if not args.no_enrol:
        await vm.enrol(read_wav(Path(args.data) / "enrol_wearer.wav"))
    results: dict[str, Any] = {"model": embedder.name, "cfg": cfg.__dict__, "enrolled": not args.no_enrol,
                               "conversations": []}
    sids: dict[str, dict[str, Any]] = {}
    for i, conv in enumerate(convs):
        sid = f"s-{conv['id']}"
        add_session(db, sid, conv, i * 5)
        sids[sid] = conv
        before = db.load_turns(sid)
        t0 = time.perf_counter()
        report = await vm.process(sid, wait_s=0) or {}
        results["conversations"].append(conv_result(db, sid, conv, before, report, time.perf_counter() - t0))
    if args.redo:  # second pass: everything heard once already (continuous memory)
        for sid in sids:
            await vm.process(sid, wait_s=0)
        results["second_pass"] = [conv_result(db, sid, c, [], store.get_run(db, sid)["report"], 0.0)  # type: ignore[index]
                                  for sid, c in sids.items()]
    results["recognition"] = recognition([(c["other_key"], r["other_voice"]) for c, r in
                                          zip(convs, results["conversations"])])
    results["voices_created"] = len(store.list_voices(db))
    results["names"] = name_scores(results["conversations"], convs)
    results["similarity"] = {"clusters": distributions(cluster_items(db, sids))}
    if not args.quick:
        results["similarity"].update({f"segments_{c or 'full'}": distributions(segment_embeddings(convs, embedder, c))
                                      for c in (1.0, 2.0, None)})
        results["timing"] = timing(convs, embedder, cfg)
    db.close()
    shutil.rmtree(tmp, ignore_errors=True)
    return results


def conv_result(db: DB, sid: str, conv: dict[str, Any], before: list[TurnFinalEvent], report: dict[str, Any],
                elapsed: float) -> dict[str, Any]:
    after = db.load_turns(sid)
    others = [s for s in store.sightings_for_session(db, sid) if s.role == "other"]
    main = max(others, key=lambda s: s.seconds) if others else None
    guess = report.get("name_guess")
    return {
        "id": conv["id"], "other": conv["other_key"], "forced_single_label": conv["forced_single_label"],
        "turns_before": turn_accuracy(conv, before) if before else None, "turns_after": turn_accuracy(conv, after),
        "words_before": word_accuracy(conv, before) if before else None, "words_after": word_accuracy(conv, after),
        "corrected": report.get("labels_corrected"), "split": report.get("turns_split"),
        "relabelled": report.get("turns_relabelled"), "wearer_source": report.get("wearer_source"),
        "wearer_similarity": report.get("wearer_similarity"),
        "speakers": [(d["decision"], d["voice_id"], d["similarity"], d["margin"], d["seconds"])
                     for d in report.get("speakers", [])],
        "other_voice": main.voice_id if main else None, "other_decision": main.decision if main else None,
        "name": guess["name"] if guess else None, "name_outcome": guess["outcome"] if guess else None,
        "truth_name": conv["other_name"] if conv["other_name_spoken"] else None,
        "elapsed_s": round(elapsed, 2), "duration_s": conv["duration_s"],
    }


def name_scores(rows: list[dict[str, Any]], convs: list[dict[str, Any]]) -> dict[str, Any]:
    returned = [r for r in rows if r["name"]]
    correct = [r for r in returned if r["truth_name"] and r["name"].lower() == r["truth_name"].lower()]
    spoken = [r for r in rows if r["truth_name"]]
    wearer_names = {c["wearer_name"].lower() for c in convs}
    return {"returned": len(returned), "correct": len(correct), "spoken": len(spoken),
            "precision": round(len(correct) / len(returned), 3) if returned else None,
            "recall": round(len(correct) / len(spoken), 3) if spoken else None,
            "wearer_name_returned": sum(r["name"].lower() in wearer_names for r in returned)}


def timing(convs: list[dict[str, Any]], embedder: Any, cfg: VoiceConfig) -> dict[str, float]:
    """A 2-minute conversation: two conversations back to back through analyse()."""
    from backend.voices.process import analyse

    a, b = convs[0], convs[1]
    audio = np.concatenate([read_wav(Path(a["wav"])), read_wav(Path(b["wav"]))])
    shift = a["duration_s"]
    words = [TimedWord(w["text"], w["start"], w["end"], w["label"]) for w in a["words"]] + \
            [TimedWord(w["text"], w["start"] + shift, w["end"] + shift, w["label"]) for w in b["words"]]
    secs = len(audio) / SAMPLE_RATE
    t0 = time.perf_counter()
    analyse(audio[: 120 * SAMPLE_RATE], 0.0, [], [w for w in words if w.end < 120], embedder, cfg)
    return {"audio_s": round(min(secs, 120.0), 1), "analyse_s": round(time.perf_counter() - t0, 2)}


def print_report(r: dict[str, Any]) -> None:
    print(f"model {r['model']}  enrolled={r['enrolled']}")
    tb = tt = wb = wt = ta = taa = wa = waa = 0
    for c in r["conversations"]:
        b, a, wb_, wa_ = c["turns_before"], c["turns_after"], c["words_before"], c["words_after"]
        tb, tt, ta, taa = tb + b[0], tt + b[1], ta + a[0], taa + a[1]
        wb, wt, wa, waa = wb + wb_[0], wt + wb_[1], wa + wa_[0], waa + wa_[1]
        print(f"{c['id']} other={c['other']} forced={c['forced_single_label']!s:5} turns {b[0]}/{b[1]} -> "
              f"{a[0]}/{a[1]}  words {wb_[0]}/{wb_[1]} -> {wa_[0]}/{wa_[1]}  split={c['split']} "
              f"wearer={c['wearer_source']}({c['wearer_similarity']}) voice={c['other_voice']}({c['other_decision']}) "
              f"name={c['name']}/{c['truth_name']} {c['elapsed_s']}s")
    print(f"TURNS  before {tb}/{tt} = {tb / tt:.1%}   after {ta}/{taa} = {ta / taa:.1%}")
    print(f"WORDS  before {wb}/{wt} = {wb / wt:.1%}   after {wa}/{waa} = {wa / waa:.1%}")
    print("recognition", r["recognition"], "voices created", r["voices_created"])
    print("names", r["names"])
    for k, v in r["similarity"].items():
        print(f"sim {k}: same {v['same']}  diff {v['different']}  eer {v['eer']}")
    print("timing", r.get("timing"))
    for c in r["conversations"]:
        print("  ", c["id"], c["speakers"])


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--data", default=str(ROOT / ".undertone" / "voice_eval"))
    p.add_argument("--model", default=None)
    p.add_argument("--no-enrol", action="store_true")
    p.add_argument("--no-llm", action="store_true")
    p.add_argument("--redo", action="store_true", help="process everything a second time")
    p.add_argument("--cfg", type=json.loads, default=None, help='VoiceConfig overrides, e.g. {"match_sim": 0.45}')
    p.add_argument("--json", default=None)
    p.add_argument("--quick", action="store_true", help="skip segment distributions and timing")
    args = p.parse_args()
    logging.basicConfig(level=logging.WARNING)
    results = asyncio.run(run(args))
    print_report(results)
    if args.json:
        Path(args.json).write_text(json.dumps(results, indent=1, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
