"""Build the labelled evaluation set for speaker "voice memory" (who is the wearer, who is the other).

Synthesises two-party conversations with Deepgram Aura-2 voices, mixes them like the band's wrist
mic hears them (wearer louder, mild noise and hum, the other slightly muffled), runs Deepgram
pre-recorded STT with diarisation, and writes ground truth next to each mix. Every network call
is cached on disk, so a rerun costs nothing.

    uv run --env-file /Users/ronitkatikaneni/undertone/.env python scripts/voice_eval_data.py \
        [--out DIR] [--seed N]

Output (default .undertone/voice_eval/ under the repo root, git-ignored):
    manifest.json, enrol_wearer.wav, e2e_1.wav, e2e_1.truth.json, e2e_2.wav, e2e_2.truth.json,
    convNN/{mix.wav, deepgram_raw.json, words.json, truth.json}, cache/{tts,stt}/...
The API key is read from the environment and never printed or written.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import struct
import sys
import wave
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import httpx
import numpy as np

SR = 16000
REPO = Path(__file__).resolve().parent.parent
DEFAULT_OUT = REPO / ".undertone" / "voice_eval"
TTS_URL = "https://api.deepgram.com/v1/speak"
STT_URL = ("https://api.deepgram.com/v1/listen?model=nova-3&diarize=true"
           "&punctuate=true&smart_format=false")
TARGET_RMS_DB = -20.0     # every TTS clip is normalised to this active level before mixing
TURN_GAP_S = 1.0          # stored-turn split on a word gap larger than this
TRIM_DB = -45.0           # TTS leading/trailing silence below this (relative to peak) is cut
E2E_LEAD_S, E2E_TAIL_S = 1.5, 2.0

# key -> candidate Aura-2 voices (first that works wins), character name, gender
VOICES: Dict[str, dict] = {
    "wearer": {"candidates": ["arcas", "apollo", "aries"], "name": "Alex", "gender": "male"},
    "A": {"candidates": ["thalia", "luna", "athena"], "name": "Priya", "gender": "female"},
    "B": {"candidates": ["andromeda", "helena", "hera"], "name": "Dana", "gender": "female"},
    "C": {"candidates": ["orpheus", "hermes", "apollo"], "name": "Dylan", "gender": "male"},
    "D": {"candidates": ["zeus", "aries", "hermes"], "name": "Marco", "gender": "male"},
}


@dataclass(frozen=True)
class Conv:
    cid: str
    other: str
    lines: Tuple[Tuple[str, str], ...]   # ("W" | "O", text)
    other_name_spoken: bool
    wearer_name_spoken_by_other: bool = False
    equal_loudness: bool = False
    forced_single_label: bool = False
    overlap_turn: Optional[int] = None   # index of the turn that starts 0.3 s early
    note: str = ""


CONVS: Tuple[Conv, ...] = (
    Conv("conv01", "A", other_name_spoken=True, note="wearer addresses the other: 'Thanks, Priya'", lines=(
        ("W", "Hey, do you have a few minutes to go over the launch checklist before tomorrow's meeting?"),
        ("O", "Yeah, sure. I was just looking at it actually. I think we're mostly in good shape, but the "
              "pricing page still has the old numbers on it, and legal hasn't signed off on the new terms."),
        ("W", "Okay. Who's handling the pricing page?"),
        ("O", "Marketing said they would, but I haven't heard back since Monday."),
        ("W", "Right, okay. I'll ping them this afternoon. What about the support docs? Last time we launched, "
              "the help center was three days behind and we got buried in tickets."),
        ("O", "Those are done. I went through every article on Friday and updated the screenshots. The only "
              "thing missing is the video walkthrough, and that's optional for day one."),
        ("W", "Great."),
        ("O", "Oh, and one more thing. The analytics dashboard isn't tracking the new signup flow yet, so we "
              "won't be able to see conversion numbers until someone adds the events."),
        ("W", "Hmm. That's a problem. We really need those numbers for the review on Friday. Can you find out "
              "who owns the tracking plan and ask whether they can get it in by Wednesday?"),
        ("O", "I can do that."),
        ("W", "Thanks, Priya. That really helps. Let's sync again tomorrow morning, maybe around nine, and we "
              "can walk through whatever is still open."),
        ("O", "Sounds good. I'll send you a calendar invite."),
    )),
    Conv("conv02", "B", other_name_spoken=True, note="other self-introduces: 'Hi, I'm Dana'", lines=(
        ("W", "Hi there. Is this seat taken?"),
        ("O", "No, go ahead. Hi, I'm Dana. I don't think we've met. Are you here for the design track or the "
              "engineering one?"),
        ("W", "Mostly engineering, but I wanted to catch the talk on accessibility this afternoon. I've heard "
              "the speaker is really good."),
        ("O", "She is. I saw her last year in Chicago. She spent the whole hour on screen readers and keyboard "
              "navigation, and honestly it changed how our team builds forms."),
        ("W", "Really? How so?"),
        ("O", "We used to treat accessibility as a final check before release. Now every ticket has acceptance "
              "criteria for it, and we test with a screen reader during review. It slowed us down for about a "
              "month, and then it just became normal."),
        ("W", "That's interesting. We've been talking about doing something like that, but nobody wants to own it."),
        ("O", "Yeah, that's the hard part."),
        ("W", "Did you have someone dedicated to it, or did the whole team just pick it up?"),
        ("O", "At first it was one person, a contractor, who wrote the checklist and ran a couple of workshops. "
              "After that the team took it over. I can send you the checklist if you want."),
        ("W", "That would be great, thank you."),
        ("O", "No problem. Here, let me grab your email before the next session starts."),
    )),
    Conv("conv03", "C", other_name_spoken=True, equal_loudness=True,
         note="other self-introduces: 'Yes, hi, I'm Dylan'; other about as loud as the wearer", lines=(
        ("W", "Hello! You must be the new neighbor. I saw the moving truck on Saturday."),
        ("O", "Yes, hi, I'm Dylan. We just moved in from Portland. Sorry about all the noise this weekend, the "
              "movers dropped a bookshelf on the stairs."),
        ("W", "Oh, don't worry about it. Welcome to the building. How are you settling in?"),
        ("O", "Slowly. Half the boxes are still taped up, and I can't find the box with the kitchen stuff, so "
              "we've been eating takeout every night."),
        ("W", "Ha. Well, there's a great noodle place two blocks down, on the corner by the pharmacy."),
        ("O", "Good to know."),
        ("W", "And the farmers market runs every Sunday morning in the parking lot behind the library. Get there "
              "early though, because the bread stand sells out by about ten."),
        ("O", "That sounds perfect. My partner bakes, so she'll probably want to compare notes with whoever "
              "runs that stand."),
        ("W", "Definitely. Also, quick heads up, the recycling pickup changed to Tuesdays last month, and the "
              "building manager is pretty strict about the bins."),
        ("O", "Right, okay. Tuesdays. I'll write that down."),
        ("W", "If you need anything, I'm in unit four, just across the hall."),
        ("O", "Thanks so much. Really appreciate it."),
    )),
    Conv("conv04", "A", other_name_spoken=False, forced_single_label=True,
         note="no names; ALL Deepgram labels forced to 0 (the real single-label failure)", lines=(
        ("W", "So I looked at the numbers from last quarter, and we're about twelve percent over on cloud costs."),
        ("O", "Twelve percent? That's more than I expected. Is it the new data pipeline?"),
        ("W", "Partly. The pipeline is maybe half of it. The rest is storage. We're keeping every raw log file "
              "forever, and nobody ever reads them after the first week."),
        ("O", "Okay, so we could move older logs to cold storage. That would cut the bill quite a bit without "
              "deleting anything."),
        ("W", "Exactly."),
        ("O", "I can draft a retention policy. Something like thirty days hot, then a year in cold storage, "
              "then delete, unless a team asks for an exception."),
        ("W", "Yeah. That sounds reasonable. Let's make sure security is fine with it though, because they had "
              "opinions about audit logs."),
        ("O", "Good point. I'll loop them in before I share it more widely."),
        ("W", "And what about the pipeline? Can we run the batch jobs less often?"),
        ("O", "Probably. Right now they run every hour, but most dashboards only refresh once a day. We could go "
              "to every six hours and nobody would notice."),
        ("W", "Okay, let's try that for two weeks and see what happens to the bill."),
        ("O", "Sure."),
    )),
    Conv("conv05", "D", other_name_spoken=False, wearer_name_spoken_by_other=True,
         note="other's name never said; the OTHER says the wearer's name: 'Thanks, Alex'", lines=(
        ("W", "Morning. I think something is wrong with my back wheel. It makes a clicking sound every time I "
              "pedal hard."),
        ("O", "Okay, let's take a look. Can you lift it onto the stand for me?"),
        ("W", "Sure. It started about a week ago, after I rode through all that rain."),
        ("O", "Yeah, I see it. The chain is pretty dry, and there's grit in the cassette. That's probably the "
              "clicking. The brake pads are also getting thin."),
        ("W", "How long would it take to fix?"),
        ("O", "A clean and lube is about twenty minutes. The brake pads another fifteen. You could wait, or "
              "come back after lunch."),
        ("W", "I'll wait, I think. I need it for my commute tomorrow."),
        ("O", "No problem."),
        ("W", "Is there anything I should be doing myself to stop this from happening again?"),
        ("O", "Honestly, just wipe the chain down after you ride in the rain, and put a few drops of oil on it "
              "every couple of weeks. That's ninety percent of it."),
        ("W", "Right. That's easy enough."),
        ("O", "Thanks, Alex. Grab a coffee from the machine if you like, it's free."),
    )),
    Conv("conv06", "B", other_name_spoken=False, wearer_name_spoken_by_other=True,
         note="other's name never said; OTHER SPEAKS FIRST ('Alex! Good to see you'), so the "
              "first-label heuristic maps her as 'me'", lines=(
        ("O", "Alex! Good to see you. How was the trip?"),
        ("W", "It was great, thanks. Really tiring though. We did four cities in ten days, which was probably "
              "too many."),
        ("O", "Four cities? Which ones?"),
        ("W", "Lisbon, Porto, then Madrid, and we finished in Barcelona. Porto was my favorite, by far. The food "
              "was incredible and everything was so cheap."),
        ("O", "Oh, I've always wanted to go to Porto."),
        ("W", "You should. Go in the spring if you can, before it gets crowded. We went in late September and it "
              "was still packed near the river."),
        ("O", "Did you get to see any of the wine cellars?"),
        ("W", "We did one tour. It was fun, but honestly the best part was a tiny restaurant we found by "
              "accident, up a hill, with maybe six tables."),
        ("O", "Those are always the best ones."),
        ("W", "Yeah."),
        ("O", "Well, welcome back. Let's grab lunch this week and you can show me the photos."),
        ("W", "Definitely. Thursday works for me."),
    )),
    Conv("conv07", "C", other_name_spoken=True, overlap_turn=5,
         note="wearer says 'Dylan' at the end; turn 6 overlaps the end of turn 5 by 0.3 s", lines=(
        ("W", "Hey, are you coming to the climbing gym again this week? We missed you on Tuesday."),
        ("O", "I wanted to, but I tweaked my shoulder last weekend. I'm trying to rest it for a few more days."),
        ("W", "Oh no. What happened?"),
        ("O", "I was on that overhang route near the back wall, and I reached for a hold that was too far. "
              "Felt a little pop. It's not serious, just sore."),
        ("W", "Okay, good. You should probably see a physio if it doesn't get better by next week, just to be safe."),
        ("O", "Yeah, I know, I know."),
        ("W", "My friend had something similar and she ignored it for a month, and it turned into a real injury. "
              "She was out for the whole summer."),
        ("O", "That's fair. I'll book something if it still hurts on Monday."),
        ("W", "Good. And when you come back, we can do the easier routes for a while, there's no rush."),
        ("O", "Sounds like a plan."),
        ("W", "Great. Feel better, and see you next week, Dylan."),
        ("O", "See you."),
    )),
    Conv("conv08", "A", other_name_spoken=True, equal_loudness=True,
         note="wearer addresses the other first: 'Priya, have you got a minute?'; equal loudness", lines=(
        ("W", "Priya, have you got a minute? I wanted to ask about the candidate from this morning."),
        ("O", "Sure. I thought she was strong overall. Her system design answer was the best we've had this month."),
        ("W", "I agree. I was a little worried about the coding round, though. She took a long time on the "
              "second problem."),
        ("O", "She did, but she talked through her reasoning the whole way, and she found the bug herself. I'd "
              "rather have that than someone who rushes and never tests anything."),
        ("W", "Fair."),
        ("O", "What did the other interviewers say?"),
        ("W", "Two strong yes, one lean yes. The lean yes was mostly about communication, which surprised me, "
              "because I thought she explained things really clearly."),
        ("O", "Hmm. Maybe it was the time pressure."),
        ("W", "Maybe. Anyway, I think we should move forward and make an offer. Can you write up the feedback "
              "summary before the debrief?"),
        ("O", "Yes, I'll have it done by three."),
        ("W", "Perfect, thank you."),
        ("O", "Of course."),
    )),
)

E2E: Tuple[Conv, ...] = (
    Conv("e2e_1", "D", other_name_spoken=True, note="other self-introduces and wearer says 'Nice to meet you, Marco'",
         lines=(
        ("W", "Hi, sorry, are you waiting for the blue meeting room too?"),
        ("O", "Oh, hi. Yes, the ten thirty. I'm Marco, I just joined the platform team last week."),
        ("W", "Nice to meet you, Marco. How are you finding it so far?"),
        ("O", "Good, mostly. Lots of new names to learn, and the build system is a bit of a maze, but everyone "
              "has been really helpful."),
        ("W", "Yeah, the build system takes a while to get used to. If you get stuck, ask in the tooling "
              "channel, people answer really fast there."),
        ("O", "Thanks, I will. Is there anyone in particular I should talk to about the deploy pipeline? I "
              "keep seeing jobs fail on my branch and I can't tell if it's me or the runners."),
        ("W", "Probably not you. The runners have been flaky all week. Talk to Sam on the infrastructure team, "
              "he knows that setup better than anyone, and he's very patient with questions."),
        ("O", "Great, that's really useful."),
        ("W", "Looks like the room is free now. After you."),
    )),
    Conv("e2e_2", "D", other_name_spoken=False, note="same other (Marco), no names said", lines=(
        ("W", "Hey, how did the deploy go last night?"),
        ("O", "Better than expected. We had one failing health check around midnight, but it was a config typo, "
              "and we fixed it in about ten minutes."),
        ("W", "Nice. Did the rollback script work when you tested it?"),
        ("O", "It did. It took about four minutes end to end, which is a lot faster than the old one."),
        ("W", "That's great news. Can you write a short note about it for the team channel?"),
        ("O", "Sure, I'll do it after lunch. Do you want me to include the timings?"),
        ("W", "Yes, please, timings and the typo. People should know what to look out for."),
        ("O", "Okay, will do. Should I also mention that the staging database was out of date? That's what "
              "made the first test run look worse than it really was."),
        ("W", "Yeah, mention it, but keep it short. And let's add a step to refresh staging before every big "
              "release, so we don't hit that again next month."),
        ("O", "Makes sense. I'll add it to the checklist."),
    )),
)

ENROL_LINES: Tuple[str, ...] = (
    "This is a short recording so the band can learn what my voice sounds like.",
    "Today I had two calls in the morning, and then I spent the whole afternoon fixing a bug that turned "
    "out to be a missing comma.",
    "Tomorrow I want to finish the quarterly report before noon, and maybe go for a run after work.",
    "I usually talk a little faster when I'm excited about something.",
)


# ---------------- audio helpers ----------------

def parse_wav(data: bytes) -> np.ndarray:
    """int16 mono samples from a WAV, tolerating streaming headers with a bogus data size."""
    if data[:4] != b"RIFF":
        raise ValueError("not a WAV response")
    pos = 12
    while pos + 8 <= len(data):
        cid, size = data[pos:pos + 4], struct.unpack("<I", data[pos + 4:pos + 8])[0]
        if cid == b"data":
            body = data[pos + 8:pos + 8 + size] if size and pos + 8 + size <= len(data) else data[pos + 8:]
            body = body[: len(body) // 2 * 2]
            return np.frombuffer(body, dtype="<i2").copy()
        pos += 8 + size + (size & 1)
    raise ValueError("WAV has no data chunk")


def write_wav(path: Path, samples: np.ndarray) -> None:
    pcm = np.clip(np.round(samples * 32767.0), -32768, 32767).astype("<i2")
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def trim_silence(x: np.ndarray, pad_s: float = 0.03) -> np.ndarray:
    frame = int(0.01 * SR)
    n = len(x) // frame
    if n == 0:
        return x
    env = np.sqrt(np.mean(x[: n * frame].reshape(n, frame) ** 2, axis=1) + 1e-12)
    thr = env.max() * 10 ** (TRIM_DB / 20)
    idx = np.nonzero(env > thr)[0]
    if len(idx) == 0:
        return x
    pad = int(pad_s * SR)
    return x[max(idx[0] * frame - pad, 0): min((idx[-1] + 1) * frame + pad, len(x))]


def active_rms(x: np.ndarray) -> float:
    frame = int(0.02 * SR)
    n = len(x) // frame
    env = np.sqrt(np.mean(x[: n * frame].reshape(n, frame) ** 2, axis=1) + 1e-12)
    loud = env[env > env.max() * 0.1]
    return float(np.sqrt(np.mean(loud ** 2))) if len(loud) else float(env.mean())


def normalise(x: np.ndarray) -> np.ndarray:
    return x * (10 ** (TARGET_RMS_DB / 20) / max(active_rms(x), 1e-6))


def muffle(x: np.ndarray) -> np.ndarray:
    """Mild low-pass (5-tap Hann FIR) to mimic the other voice being further from the wrist."""
    k = np.hanning(7)[1:-1]
    return np.convolve(x, k / k.sum(), mode="same")


def room_noise(n: int, rng: np.random.Generator) -> np.ndarray:
    """Unit-RMS pink-ish noise plus a faint 60/120 Hz hum."""
    spec = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR)
    spec *= 1 / np.sqrt(np.maximum(f, 20.0))
    pink = np.fft.irfft(spec, n)
    pink /= np.sqrt(np.mean(pink ** 2)) + 1e-12
    t = np.arange(n) / SR
    hum = 0.15 * np.sin(2 * np.pi * 60 * t) + 0.07 * np.sin(2 * np.pi * 120 * t + 0.7)
    x = pink + hum
    return x / (np.sqrt(np.mean(x ** 2)) + 1e-12)


# ---------------- Deepgram (cached) ----------------

class Deepgram:
    def __init__(self, cache: Path) -> None:
        self.cache = cache
        self.key = os.environ.get("DEEPGRAM_API_KEY", "")
        self.tts_calls = 0
        self.stt_calls = 0
        self._client = httpx.Client(timeout=180)

    def _need_key(self) -> None:
        if not self.key:
            sys.exit("DEEPGRAM_API_KEY is not set (run with --env-file .env)")

    def tts(self, voice: str, text: str) -> Optional[np.ndarray]:
        """Float samples at 16 kHz, or None if Deepgram rejects the voice (4xx)."""
        h = hashlib.sha1(f"{voice}|{text}".encode()).hexdigest()[:16]
        path = self.cache / "tts" / f"{voice}_{h}.wav"
        if not path.exists():
            self._need_key()
            params = {"model": f"aura-2-{voice}-en", "encoding": "linear16",
                      "sample_rate": str(SR), "container": "wav"}
            resp = self._client.post(TTS_URL, params=params, json={"text": text},
                                     headers={"Authorization": f"Token {self.key}"})
            self.tts_calls += 1
            if 400 <= resp.status_code < 500:
                print(f"  tts {voice}: HTTP {resp.status_code}, trying another voice")
                return None
            resp.raise_for_status()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(resp.content)
        return parse_wav(path.read_bytes()).astype(np.float32) / 32768.0

    def stt(self, wav_path: Path) -> dict:
        data = wav_path.read_bytes()
        h = hashlib.sha256(data).hexdigest()[:20]
        path = self.cache / "stt" / f"{h}.json"
        if not path.exists():
            self._need_key()
            resp = self._client.post(STT_URL, content=data, headers={
                "Authorization": f"Token {self.key}", "Content-Type": "audio/wav"})
            self.stt_calls += 1
            resp.raise_for_status()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(resp.json()))
        return json.loads(path.read_text())


def resolve_voices(dg: Deepgram) -> Dict[str, str]:
    """key -> working Aura-2 voice name (first candidate that synthesises)."""
    chosen: Dict[str, str] = {}
    for key, spec in VOICES.items():
        for cand in spec["candidates"]:
            if cand in chosen.values():
                continue
            if dg.tts(cand, "Hello.") is not None:
                chosen[key] = cand
                break
        if key not in chosen:
            sys.exit(f"no working Aura-2 voice for {key}")
    return chosen


# ---------------- rendering ----------------

@dataclass(frozen=True)
class MixPlan:
    other_gain_db: float      # other level relative to wearer (negative = quieter)
    snr_db: float             # noise below wearer speech level
    muffle_other: bool
    lead_s: float = 0.4
    tail_s: float = 0.6


def plan_for(conv: Conv, rng: np.random.Generator, e2e: bool = False) -> MixPlan:
    gain = -float(rng.uniform(-0.5, 1.0)) if conv.equal_loudness else -float(rng.uniform(3.0, 10.0))
    lead, tail = (E2E_LEAD_S, E2E_TAIL_S) if e2e else (0.4, 0.6)
    return MixPlan(round(gain, 2), round(float(rng.uniform(15.0, 25.0)), 2),
                   bool(rng.random() < 0.7), lead, tail)


def synth_turns(dg: Deepgram, conv: Conv, voices: Dict[str, str]) -> List[np.ndarray]:
    out = []
    for who, text in conv.lines:
        key = "wearer" if who == "W" else conv.other
        clip = dg.tts(voices[key], text)
        if clip is None:
            sys.exit(f"TTS failed for {conv.cid}")
        out.append(normalise(trim_silence(clip)))
    return out


def render(conv: Conv, clips: Sequence[np.ndarray], plan: MixPlan,
           rng: np.random.Generator) -> Tuple[np.ndarray, List[dict]]:
    """Place turns on a timeline; returns (mixed float signal, truth segments)."""
    starts, t = [], plan.lead_s
    for i, clip in enumerate(clips):
        if i > 0:
            t += -0.3 if conv.overlap_turn == i else float(rng.uniform(0.15, 0.9))
        starts.append(t)
        t += len(clip) / SR
    total = int((t + plan.tail_s) * SR)
    mix = np.zeros(total, dtype=np.float64)
    segs = []
    other_gain = 10 ** (plan.other_gain_db / 20)
    for (who, text), clip, st in zip(conv.lines, clips, starts):
        is_me = who == "W"
        sig = clip if is_me else (muffle(clip) if plan.muffle_other else clip) * other_gain
        i0 = int(round(st * SR))
        mix[i0:i0 + len(sig)] += sig
        segs.append({"speaker_key": "wearer" if is_me else conv.other, "role": "me" if is_me else "other",
                     "start": round(st, 3), "end": round(st + len(clip) / SR, 3), "text": text})
    noise_rms = 10 ** ((TARGET_RMS_DB - plan.snr_db) / 20)
    mix += room_noise(total, rng) * noise_rms
    peak = np.max(np.abs(mix))
    if peak > 0.95:
        mix *= 0.95 / peak
    return mix, segs


# ---------------- words, truth, stored turns ----------------

def dg_words(resp: dict) -> List[dict]:
    alts = resp["results"]["channels"][0]["alternatives"]
    return [{"text": w.get("punctuated_word") or w["word"], "start": round(float(w["start"]), 3),
             "end": round(float(w["end"]), 3), "label": int(w.get("speaker", 0))}
            for w in (alts[0].get("words") or [])]


def role_of(t: float, segs: Sequence[dict]) -> dict:
    """Segment containing t (closest centre if overlapping), else the nearest segment."""
    inside = [s for s in segs if s["start"] <= t <= s["end"]]
    if inside:
        return min(inside, key=lambda s: abs((s["start"] + s["end"]) / 2 - t))
    return min(segs, key=lambda s: min(abs(s["start"] - t), abs(s["end"] - t)))


def label_words(words: Sequence[dict], segs: Sequence[dict]) -> List[dict]:
    out = []
    for w in words:
        seg = role_of((w["start"] + w["end"]) / 2, segs)
        out.append({**w, "truth_role": seg["role"], "truth_speaker_key": seg["speaker_key"]})
    return out


def make_turn(n: int, speaker: str, words: Sequence[dict]) -> dict:
    start, end = words[0]["start"], words[-1]["end"]
    dur = max(end - start, 0.5)
    return {"turn_id": f"t{n}", "speaker": speaker, "text": " ".join(w["text"] for w in words).strip(),
            "start": round(start, 3), "end": round(end, 3),
            "wpm": round(len(words) / dur * 60, 1), "fillers": []}


def stored_turns(words: Sequence[dict]) -> List[dict]:
    """Live-style turns: a run of one label, split on label change or a gap > TURN_GAP_S.
    The first label heard is 'me', every other label is 'other'."""
    if not words:
        return []
    me_label = words[0]["label"]
    groups: List[List[dict]] = [[words[0]]]
    for w in words[1:]:
        prev = groups[-1][-1]
        if w["label"] != prev["label"] or w["start"] - prev["end"] > TURN_GAP_S:
            groups.append([w])
        else:
            groups[-1].append(w)
    return [make_turn(i + 1, "me" if g[0]["label"] == me_label else "other", g)
            for i, g in enumerate(groups)]


def word_accuracy(words: Sequence[dict]) -> float:
    """Share of words whose stored-turn speaker matches the truth role (diagnostic only)."""
    me_label = words[0]["label"] if words else 0
    ok = sum(("me" if w["label"] == me_label else "other") == w["truth_role"] for w in words)
    return round(ok / max(len(words), 1), 3)


# ---------------- per-item builders ----------------

def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, indent=1))


def base_truth(conv: Conv, plan: MixPlan, segs: List[dict], duration: float) -> dict:
    return {
        "id": conv.cid, "wearer_key": "wearer", "other_key": conv.other,
        "wearer_name": VOICES["wearer"]["name"], "other_name": VOICES[conv.other]["name"],
        "other_name_spoken": conv.other_name_spoken,
        "wearer_name_spoken_by_other": conv.wearer_name_spoken_by_other,
        "first_speaker_role": segs[0]["role"], "note": conv.note,
        "duration_s": round(duration, 2), "mix": {
            "other_gain_db": plan.other_gain_db, "snr_db": plan.snr_db,
            "other_muffled": plan.muffle_other, "overlap_turn_index": conv.overlap_turn},
        "segments": segs,
    }


def build_conversation(dg: Deepgram, conv: Conv, voices: Dict[str, str], out: Path, seed: int,
                       idx: int) -> dict:
    rng = np.random.default_rng(seed * 1000 + idx)
    plan = plan_for(conv, rng)
    mix, segs = render(conv, synth_turns(dg, conv, voices), plan, rng)
    cdir = out / conv.cid
    write_wav(cdir / "mix.wav", mix)
    raw = dg.stt(cdir / "mix.wav")
    write_json(cdir / "deepgram_raw.json", raw)
    words = dg_words(raw)
    if conv.forced_single_label:
        words = [{**w, "label": 0} for w in words]
    write_json(cdir / "words.json", words)
    labelled = label_words(words, segs)
    truth = base_truth(conv, plan, segs, len(mix) / SR)
    truth.update({"forced_single_label": conv.forced_single_label,
                  "deepgram_labels_seen": sorted({w["label"] for w in dg_words(raw)}),
                  "words": labelled, "stored_turns": stored_turns(words),
                  "stored_turn_word_accuracy": word_accuracy(labelled)})
    write_json(cdir / "truth.json", truth)
    print(f"  {conv.cid}: other={conv.other} {truth['duration_s']}s words={len(words)} "
          f"labels={truth['deepgram_labels_seen']} stored_turns={len(truth['stored_turns'])} "
          f"label_acc={truth['stored_turn_word_accuracy']}")
    return {"id": conv.cid, "other_key": conv.other, "duration_s": truth["duration_s"],
            "forced_single_label": conv.forced_single_label, "other_name_spoken": conv.other_name_spoken,
            "wearer_name_spoken_by_other": conv.wearer_name_spoken_by_other,
            "first_speaker_role": truth["first_speaker_role"], "note": conv.note,
            "files": {k: f"{conv.cid}/{v}" for k, v in (("wav", "mix.wav"), ("truth", "truth.json"),
                                                         ("words", "words.json"),
                                                         ("deepgram_raw", "deepgram_raw.json"))}}


def build_e2e(dg: Deepgram, conv: Conv, voices: Dict[str, str], out: Path, seed: int, idx: int) -> dict:
    rng = np.random.default_rng(seed * 1000 + 500 + idx)
    plan = plan_for(conv, rng, e2e=True)
    mix, segs = render(conv, synth_turns(dg, conv, voices), plan, rng)
    write_wav(out / f"{conv.cid}.wav", mix)
    write_json(out / f"{conv.cid}.truth.json", base_truth(conv, plan, segs, len(mix) / SR))
    print(f"  {conv.cid}: other={conv.other} {len(mix) / SR:.1f}s turns={len(segs)}")
    return {"id": conv.cid, "other_key": conv.other, "duration_s": round(len(mix) / SR, 2),
            "other_name_spoken": conv.other_name_spoken, "note": conv.note,
            "files": {"wav": f"{conv.cid}.wav", "truth": f"{conv.cid}.truth.json"}}


def build_enrolment(dg: Deepgram, voices: Dict[str, str], out: Path, seed: int) -> dict:
    """15-20 s of the wearer alone, same mic treatment (noise, hum)."""
    rng = np.random.default_rng(seed * 1000 + 900)
    parts, total = [], 0.0
    for line in ENROL_LINES:
        clip = dg.tts(voices["wearer"], line)
        if clip is None:
            sys.exit("TTS failed for enrolment")
        clip = normalise(trim_silence(clip))
        if total + len(clip) / SR > 20.0 and total >= 15.0:
            break
        parts.append(clip)
        total += len(clip) / SR
        parts.append(np.zeros(int(rng.uniform(0.3, 0.6) * SR)))
    sig = np.concatenate([np.zeros(int(0.3 * SR))] + parts)[: int(20.0 * SR)]
    sig = sig + room_noise(len(sig), rng) * 10 ** ((TARGET_RMS_DB - float(rng.uniform(15, 25))) / 20)
    write_wav(out / "enrol_wearer.wav", sig)
    print(f"  enrol_wearer: {len(sig) / SR:.1f}s")
    return {"file": "enrol_wearer.wav", "duration_s": round(len(sig) / SR, 2), "speaker_key": "wearer"}


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--seed", type=int, default=7)
    args = ap.parse_args(argv)
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    dg = Deepgram(out / "cache")
    voices = resolve_voices(dg)
    print("voices: " + ", ".join(f"{k}={v}" for k, v in voices.items()))
    convs = [build_conversation(dg, c, voices, out, args.seed, i) for i, c in enumerate(CONVS)]
    e2e = [build_e2e(dg, c, voices, out, args.seed, i) for i, c in enumerate(E2E)]
    enrol = build_enrolment(dg, voices, out, args.seed)
    manifest = {
        "seed": args.seed, "sample_rate": SR, "wearer_key": "wearer",
        "voices": [{"key": k, "aura_voice": f"aura-2-{voices[k]}-en", "name": v["name"], "gender": v["gender"]}
                   for k, v in VOICES.items()],
        "conversations": convs, "e2e": e2e, "enrolment": enrol,
        "stored_turn_rules": {"gap_s": TURN_GAP_S, "me": "first label heard", "fillers": "always []"},
    }
    write_json(out / "manifest.json", manifest)
    print(f"done: {out} (new requests this run: tts={dg.tts_calls} stt={dg.stt_calls})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
