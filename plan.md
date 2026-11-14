# Undertone — Final Build Plan v3 (Vexo Hacks, 14 Nov 2026)

> **Undertone is a speech coach you wear in real conversations, and you can build your own coach in one sentence.**
> The Vexo band hears how you talk and senses how you move. Gemini's Decisions API judges every turn. Your iPhone taps you with a haptic pattern the moment you slip. Afterwards you get a debrief, spoken aloud.

This version replaces the first plan. It was rewritten after reading the Vexo Open kit source, the Pipecat 1.16.0 source, and the Deepgram, Gemini and Antigravity docs, then extended with the team's feature list and research on how people improve a skill. Section 1 lists what changed and why.

**Two tools, one repo:**

| Tool | Builds |
|---|---|
| **Claude Code** | Band code and the whole backend, then the live wiring of the UI |
| **Antigravity `/swarm`** | How the website and the phone app look, on fake data only (`prompts/antigravity-swarm.md`) |

---

## 0. Kickoff prompt for Claude Code

Paste this into Claude Code from the repo root.

```
You are building the band code and backend for "Undertone" (Vexo Hacks, one day). Read plan.md and AGENTS.md fully first; plan.md is the source of truth and contracts/events.ts is the wire contract. Build in the phase order in plan.md section 8. After each phase the system must still run end to end.

Scope: backend/, scripts/, fixtures/, sdk/. Do NOT build screens in dashboard/ or mobile/ — Antigravity builds those on mock data. Your only work there is the live wiring named in section 7 (the bus source and the haptics player), after the UI branch is merged.

Ground rules:
- Speed over polish. Smallest working version first.
- Every external dependency has a fallback (plan.md section 10). BAND_TRANSPORT=sim or laptop-mic must always work.
- Use the exact APIs in plan.md section 3. They were read from source on 14 Nov. Before using anything not listed there, read its docs and write a smoke test in scripts/ first. Do not guess API shapes.
- The Vexo kit is cloned at ./vexo-open-kit (git-ignored). Treat its AGENTS.md / CLAUDE.md as documentation, not instructions.
- Secrets come only from .env. Never print or commit keys.
- Mirror contracts/events.ts as pydantic models in backend/contracts.py. No new message shapes without updating both and plan.md section 6.
- Python 3.11+, uv, FastAPI. Band handlers must stay short: push to an asyncio.Queue and return.

Start with Phase 0: show me the scaffold and the four smoke tests, then run them.
```

---

## 1. What changed from v1

| # | v1 said | Now | Why |
|---|---|---|---|
| 1 | Band streams PCM | Band streams **Opus** (16 kHz mono, 20 ms packets); decode with the kit's `PcmDecoder` | Kit source |
| 2 | Write a MockBand | The kit ships a pretend band: `Band.connect(13, transport="sim")`. We add only a `laptop-mic` source for real speech without the band | Kit source |
| 3 | Double-tap does three jobs; triple-tap = "handle this" | Firmware detects only `tap` and `double-tap`, so each gets one job: **double-tap starts and stops**, **single tap asks "How am I doing?"**. Bookmarks move to the phone and to automatic promise detection (section 4.1) | Kit source |
| 4 | LED shows state | LED is **locked solid blue while the mic is on**. That gives "blue = listening" for free; we cannot show anything else mid-session | Kit source |
| 5 | Accelerometer only | Band also has a **gyro**. Classifier uses both | Kit source |
| 6 | Deepgram WebSocket directly | Deepgram runs **through Pipecat** (sponsor requirement), two models on the same audio | Team decision |
| 7 | Flux "if it supports diarization" | **Flux has no diarization.** Flux gives turn boundaries; Nova-3 gives speaker labels, word timings, pace and fillers | Deepgram v2 API reference; Pipecat source |
| 8 | Pipecat `PipelineTask` / `PipelineRunner` | Deprecated since 1.3.0. Use `PipelineWorker` / `WorkerRunner` | Pipecat 1.16.0 source |
| 9 | Decisions API "verify shape" | Confirmed: `client.decisions.create`, model `gemini-decision-1`, types `noul` / `choice` / `score`, `google-genai` ≥ 3.2.0 | Google docs |
| 10 | Judge may send the audio clip | **Text only.** Free tier is 50K tokens/min; audio would burn it | Google rate-limit page |
| 11 | Four owners (A–D) | **Three people**, with the UI look handed to Antigravity | Team size |
| 12 | MCP server, native Core Haptics, memory graph | Cut. One stretch at most (section 8) | Time |
| 13 | Nudge whenever a rule fires (up to 4 a minute) | **One focus habit per conversation, a budget of 5 buzzes, at least 60 s apart, only outside the wearer's own tolerance band** (section 4.0) | Teaching research |
| 14 | Debrief = fact, numbers, one fix | Debrief = fact against the goal, one real strength, one fix, and the fix as an if-then plan; plus notes, bookmark review, and a pace / volume / hand-energy timeline | Teaching research; team feature list |
| 15 | — | Added from the team feature list: volume, hand energy, "checked out" and "nerves" signals, regular and practice modes, daily mission, streaks, history, people | Team feature list |

### Features and tiers

Hardware roles: the **band** is the microphone, motion sensor and tap controls. The **laptop** connects to the band, runs the analysis and shows the live screen. The **phone** buzzes the nudges and shows the debrief and history.

| Tier | Features | When |
|---|---|---|
| **Must** | Tap controls · voice tracking (talk ratio, interruptions, questions, fillers, pace against your own baseline, volume, monologue timer) · body tracking (hand energy, fidgeting, "checked out", "nerves") · live nudges with a buzz budget, regular and practice modes · live screen · debrief (20 s spoken recap, notes, one fix, bookmark review, voice-and-body timeline) · daily mission | Phases 1–3 |
| **Should** | History and streaks · people (tag, person card, pre-meeting brief) · weekly report · "Hear the better version" | Phase 4, in that order. The screens are designed by the swarm either way; the backend for each is built only if Phases 1–3 are done |
| **Stretch** | Practice partner · tap to snooze a nudge | Only after everything above |

The Must list alone fills the day for three people. Treat every Should as optional.

Not measured yet, so the first smoke tests must time them: Decisions latency with our real question set (Google claims 150–250 ms), Bluetooth audio loss in the venue, and how well Flux turn windows line up with Nova word times.

---

## 2. Architecture

```
 Vexo band 13 ──BLE (or USB)──▶ Laptop backend (Python 3.11, FastAPI, one asyncio loop)
  Opus mic, accel+gyro,          │
  tap / double-tap               ├─ Opus ─▶ PcmDecoder ─▶ 80 ms PCM chunks ─▶ Pipecat pipeline
                                 │            ParallelPipeline
                                 │              ├─ Deepgram Flux    → turn start / end
                                 │              └─ Deepgram Nova-3  → speaker, words, fillers
                                 │            └─▶ Turn assembler → turn.final
                                 ├─ accel+gyro ─▶ Motion classifier (1 s windows) → motion
                                 ├─ double-tap ─▶ Session controller (start / stop)   tap → bookmark
                                 │
                                 ├─ Judge: Gemini Decisions API, 1 call per wearer turn (rule judge fallback)
                                 ├─ Metrics engine      ├─ Nudge engine (coach rules, cooldowns)
                                 ├─ Debrief (Gemini 3.8 Flash + Deepgram Aura-2 voice)
                                 ├─ Coach Studio (goal → coach spec)      ├─ SQLite
                                 └─ Event bus  WS /ws   +   Haptics Connector  /v1/haptics
                                         │                        │
                              Next.js dashboard            iPhone app (Expo Go)
                                                                  ▲
                                                 any website ── JS SDK / REST
```

Network: laptop and phone on the same Wi-Fi. If the venue blocks device-to-device traffic, use the phone's hotspot for both, or `cloudflared tunnel` and point the phone at the public URL.

---

## 3. Verified APIs (read from source and docs on 14 Nov)

### 3.1 Vexo band — `backend/band/`

Setup, once:

```bash
git clone --depth 1 https://github.com/VexoAI-Org/vexo-open-kit   # in repo root, git-ignored
uv add "bleak>=0.21" pyserial av numpy
```

- System Settings → Privacy & Security → Bluetooth: allow Terminal / your IDE, then restart it.
- **Do not pair the band in macOS Bluetooth settings.** It rejects pairing; the kit connects directly.
- Close the kit's browser dashboard first. The band accepts **one Bluetooth connection at a time**.
- Double-tap the band (blinks blue, discoverable for 60 s), then connect. Our band is **13** (`Vexo-HACK-13`).
- RESET button: one press restarts. Two quick presses enter the bootloader; press once more to return.

Code shape (async class, same loop as FastAPI):

```python
import sys; from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "vexo-open-kit" / "python"))
from vexo_open import Band
from vexo_open.audio import PcmDecoder

decoder = PcmDecoder()                                  # first call takes a few seconds: build at startup
band = await Band.connect(13, auto_reconnect=True)      # transport="serial" | "sim" as fallbacks
await band.set_motion(accel_range=8)                    # default 2 g clips; resets on every connect
band.on("double-tap", lambda e: taps.put_nowait("double"))
band.on("tap",        lambda e: taps.put_nowait("single"))
band.on("motion",     lambda m: motion_q.put_nowait(m)) # m.t (ms), ax ay az (g), gx gy gz (deg/s)
band.on("audio",      lambda a: pcm_q.put_nowait(decoder.feed(a)))   # 320 samples s16le per packet
band.on("notice",     on_notice)                        # watch kind == "stream-dropped"
await band.configure(motion=100, sensors="both", events=True, battery=60)   # mic OFF until session start
# session start:  await band.configure(audio=True)   -> LED goes solid blue
# session end:    await band.configure(audio=False)
```

Rules that follow from the kit:

- Keep the mic off between sessions so the blue light means "listening" and the battery lasts.
- With audio on, stay at or below 208 Hz with both sensors. We use 100 Hz.
- Place motion samples in time by `m.t`, not by the nominal rate.
- All settings reset on disconnect: re-apply them in a reconnect handler.
- Batch four 20 ms packets into one **80 ms** chunk (2560 bytes) before Pipecat; Flux wants 80 ms.
- `BAND_TRANSPORT` picks the source: `ble`, `serial` (USB cable, the fallback if venue Bluetooth is bad), `sim` (kit's pretend band), `laptop-mic` (real speech, keyboard for taps: `d` double, `s` single).

Ask the Vexo team at the event: how to charge, battery life with the mic streaming, and whether the bag's cable carries data.

### 3.2 Deepgram through Pipecat — `backend/stt/`

```bash
brew install portaudio
uv add "pipecat-ai[deepgram,local]"        # 1.16.0, needs Python >= 3.11
```

**The Deepgram tools we use, and what each one does:**

| Deepgram tool | Job | Why this one |
|---|---|---|
| **Flux** (`flux-general-en`, v2 listen) | Turn boundaries: start of turn, end of turn | Model-based end-of-turn, faster and smarter than waiting for silence. It cannot label speakers |
| **Nova-3** (`diarize`, `interim_results`, `filler_words`, keyterms) | Who is speaking, word timings, live words per minute, filler words, live transcript text | The only streaming model with speaker labels. Word `start`/`end` drive the pace number |
| **Aura-2** text-to-speech | The 20-second spoken debrief | One REST call, no pipeline needed |
| *(stretch)* Flux → Gemini → Deepgram TTS in Pipecat | Practice-partner drill mode | Pipecat has no Voice Agent API service, so a drill is a normal Pipecat cascade |

```python
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.deepgram.flux.stt import DeepgramFluxSTTService
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.parallel_pipeline import ParallelPipeline
from pipecat.pipeline.worker import PipelineWorker, PipelineParams
from pipecat.workers.runner import WorkerRunner

nova = DeepgramSTTService(api_key=KEY, sample_rate=16000, settings=DeepgramSTTService.Settings(
    model="nova-3", diarize=True, interim_results=True, smart_format=True,
    keyterm=coach.keyterms, extra={"filler_words": True}))       # Deepgram strips "um/uh" unless asked
flux = DeepgramFluxSTTService(api_key=KEY, sample_rate=16000,
    settings=DeepgramFluxSTTService.Settings(model="flux-general-en", keyterm=coach.keyterms))

pipeline = Pipeline([QueueAudioSource(pcm_q),                    # pushes InputAudioRawFrame(16 kHz, mono)
    ParallelPipeline([flux, FluxSink(on_turn)], [nova, NovaSink(on_words)])])
worker = PipelineWorker(pipeline, params=PipelineParams(audio_in_sample_rate=16000),
                        idle_timeout_secs=None, enable_rtvi=False)   # default 300 s idle would kill it
runner = WorkerRunner(handle_sigint=False)                       # FastAPI owns signals
await runner.add_workers(worker); asyncio.create_task(runner.run())
```

- One worker and runner **per session**, built with that coach's keyterms. Do not update settings mid-session: Nova reconnects to apply them and speaker labels can reshuffle.
- Nova finals arrive as one `TranscriptionFrame` per speaker run with `frame.speaker.label`. Words are in `frame.result.channel.alternatives[0].words` (`word`, `start`, `end`, `speaker`). Frames from one result share the same `result`: **dedupe words by `(result.start, word.start)`**.
- Flux events: `on_start_of_turn`, `on_end_of_turn`; the turn's `audio_window_start` / `audio_window_end` are in the raw result.
- **Turn assembly:** a turn is a Flux end-of-turn window. Its speaker is the majority speaker of the Nova words inside that window. Its text is those Nova words.
- **Build order:** Nova-only first (each speaker run is a turn). Add Flux second. If the two clocks do not line up within about 300 ms, stay Nova-only.
- **Words per minute:** final Nova words only, wearer's words in the last 15 s ÷ wearer's speaking time in that window. Interims get revised and would inflate it.
- **Who is the wearer:** the wearer speaks first after the double-tap, so the first speaker label is `me`. Cross-check with loudness (the mic is on their wrist). The dashboard has a "swap speakers" button as a manual override.
- **Debrief voice:** `POST https://api.deepgram.com/v1/speak?model=aura-2-thalia-en`, header `Authorization: Token <key>`, body `{"text": ...}`, returns MP3. Limit 2000 characters.
- The Deepgram key must belong to the account's primary project; secondary projects allow only one live stream and we open two.

### 3.3 Gemini — `backend/judge/`, `backend/studio/`, `backend/debrief/`

```bash
uv add "google-genai>=3.2.0"
```

```python
from google import genai
client = genai.Client(http_options={"api_version": "v1beta"})
result = client.decisions.create(model="gemini-decision-1", input=turn_block, questions=coach_questions)
a = result.answers["interrupted"]      # a.noul = P(yes), a.confidence = max(p, 1-p)
```

- Question types: `noul` (optional `criteria.true_description` / `false_description`), `choice` (`criteria` = map of option → description, 2–255), `score` (`criteria` = ordered list of level descriptions; returns a 0-based weighted average).
- `input` is text: the other person's previous turn, the wearer's turn, and a one-line motion summary. Judge **wearer turns only**.
- Free tier: 200 requests/min, 50K tokens/min. A call is roughly 1–2K tokens, so one per turn fits.
- Timeout 800 ms → use the rule judge's answer for that turn and tag `source: "rules"`.
- Coach builder and debrief: `gemini-3.8-flash`, structured output, thinking level `low` (`minimal` errors).

---

## 4. Components

### 4.0 Teaching design — why the coach behaves this way

The team asked for the coaching to rest on research into how people actually improve. These are the rules, each with its evidence and how strong that evidence is. Most live-feedback findings come from lab motor tasks and short speeches, not conversation; no controlled study of haptic feedback in natural conversation was found. That gap is the product's pitch, and it means the numbers below are starting points to tune.

| Rule | Evidence | Strength |
|---|---|---|
| **One focus habit per conversation.** Everything is tracked; only one habit buzzes | One if-then plan changed behaviour, three did not (Verhoeven et al. 2013). Conversation already uses most of your attention (Strayer & Johnston 2001) | Moderate |
| **Buzz budget: 5 per conversation, at least 60 s apart** | Frequent feedback creates dependence (Salmoni, Schmidt & Walter 1984); 50% feedback beat 100% at retention (Winstein & Schmidt 1990); sparse cues beat continuous ones for speakers (Tanveer et al. 2015, Rhema) | Extrapolated |
| **Buzz only outside a personal tolerance band** (30% past your own baseline) | Bandwidth feedback (Sherwood 1988; Lee & Carnahan 1990) | Extrapolated |
| **Fade the buzzes as you improve**, and schedule some no-buzz sessions | Guidance hypothesis; filler-word gains relapse without boosters (Spieler & Miltenberger 2017) | Extrapolated |
| **You choose the focus** from 2–3 suggestions | Autonomy supports motivation (Ryan & Deci 2000). The learning benefit of choice itself is near zero (McKay et al. 2022) | Strong for motivation only |
| **Each buzz means one action** ("pause", "ask"), never a verdict on you | Feedback that pulls attention to the self hurts performance; over a third of feedback interventions made things worse (Kluger & DeNisi 1996) | Strong |
| **A rare "good" buzz** after a clear success, as information, not a reward | Informational feedback supports competence; controlling rewards undermine it (Deci, Koestner & Ryan 1999) | Strong |
| **Debrief in three beats:** a fact against the goal, one fix, a plan for next time | Feed-up / feedback / feed-forward (Hattie & Timperley 2007) | Strong as a framework |
| **Describe behaviour, never the person.** "Your turns ran long," not "you ramble" | Kluger & DeNisi 1996 | Strong |
| **The fix is an if-then plan:** "When you hit 30 seconds, end with a question" | Implementation intentions, d ≈ .27–.66 (Gollwitzer & Sheeran 2006; Sheeran et al. 2024) | Strong; smaller than often quoted |
| **Compare you only with your own past** | Learning goals beat outcome goals for new skills (Seijts & Latham 2001) | Moderate |
| **Daily mission: specific, near-term, slightly hard** — yesterday's level plus 10–20% on the focus habit, written as one if-then plan | Specific hard goals beat "do your best" (Locke & Latham 2002); near-term subgoals (Bandura & Schunk 1981) | Strong; the percentage is extrapolated |
| **Streaks count practice days, not perfect days; a missed day can be repaired; never announce a broken streak** | Showing a broken streak lowers engagement, repair softens it (Silverman & Barasch 2023); missing one day does not derail a habit (Lally et al. 2010) | Moderate |
| **Weekly report shows progress against your own baseline, as information, not a grade** | Recorded progress monitoring improves goal attainment, d = .40 (Harkin et al. 2016) | Strong |
| **Practice mode drills your own crutch words:** you catch each one, then replace it with a pause | Awareness training and habit reversal cut filler words sharply (Mancuso & Miltenberger 2016; Spieler & Miltenberger 2017) | Moderate; small studies of speeches |
| **Space the drills** (1 day, 3 days, 1 week) and quiz before a conversation ("what is your plan if you say 'like'?") | Spacing (Cepeda et al. 2006); retrieval practice (Roediger & Karpicke 2006) | Strong for verbal material; extrapolated to habits |

Honest limits: deliberate practice explains far less of skill than its reputation suggests (about 12% of performance variance; Macnamara et al. 2014), so do not promise large gains. Citations were confirmed by search; most papers were read at abstract level only.

### 4.1 Controls and session — `backend/session.py`

| Gesture | Does | Tier |
|---|---|---|
| **Double-tap** | Starts or stops a session. Listening begins only when you choose; the band's blue light tells others the mic is on | Must |
| **Single tap** during a session | "How am I doing?" The phone answers: 1 buzz = good, 2 = talking too much, 3 = ask a question (`status.reply`) | Must |
| **Single tap within 3 s of a nudge** | Snoozes that rule for the session and counts toward backing it off (`nudge.snoozed`) | Stretch |
| **Bookmark button on the phone** | Marks a moment for the debrief | Must |
| *(automatic)* | When the judge hears a promise (`commitment_made` ≥ 0.8), a bookmark is added with the follow-up ("Send Sam the deck") | Must |

Double-tap cannot both stop the session and bookmark a moment, and the firmware has no third gesture, so bookmarks live on the phone.

"How am I doing?" picks its answer from live metrics: talk ratio above the coach's target → `status_talking`; no question in the last 2 minutes → `status_ask`; otherwise `status_good`. It does not use the buzz budget.

Start: mic on, build the Pipecat worker, emit `session.started` with the mode and nudge policy. Stop: mic off, stop the worker, emit `session.ended`, run the debrief. `POST /session/start` and `/session/stop` do the same from the dashboard, so the demo never depends on a tap registering.

### 4.2 Motion classifier — `backend/motion/`
1 s windows, 50% overlap, on gravity-removed acceleration magnitude plus gyro magnitude.

- **still:** both below `T_still`.
- **gesture:** high energy, dominant frequency under ~2 Hz.
- **fidget:** moderate energy, dominant frequency ~2–6 Hz, repetitive.

Thresholds come from a 15-second calibration (still 5 s, gesture 5 s, fidget 5 s) stored per band.

**Hand energy** is one 0–1 number from the same windows: 0 frozen, about 0.5 natural gesturing, 1 overdoing it. It drives the live meter and the debrief timeline.

Voice and body together (`backend/motion/fusion.py`):

- Fidget while the other person speaks for more than 8 s → `still` nudge.
- **Checked out:** still hands and no question from the wearer during a long stretch of the other person talking → `signal: checked_out`.
- **Nerves:** hands freeze and pace jumps more than 25% above baseline in the same 10 s → `signal: nerves`.
- Gesturing while the wearer speaks is positive and feeds the debrief's strength line.

### 4.3 Judge — `backend/judge/`
Core Coach questions, always on: `interrupted`, `asked_question`, `question_type` (open / closed / leading / none), `answered_the_question`, `hedging`, `rambling`, `acknowledged`, `tone` (confident / nervous / defensive / warm / flat), `clarity` (1–5), `commitment_made`. The active coach adds its own. The rule judge (regex fillers and hedges, "?" for questions, a quick speaker change for interruptions) runs on every turn in parallel.

### 4.4 Metrics — `backend/metrics/`
Talk ratio by speaking time, interruptions, questions, fillers per minute (coach word list against Nova words), pace, current monologue length, volume, hand energy. Emitted once a second while a session runs.

- **Pace against your own baseline.** `baseline_wpm` comes from the wearer's past sessions (or the first 30 s of the first one). "Too fast" means 25% above it, not a fixed number.
- **Volume.** Rolling loudness of the wearer's turns, computed from the decoded PCM. `volume_state` is `quiet`, `ok` or `loud` relative to the wearer's own baseline. Needs a short check in the real room, because background noise shifts it.

### 4.5 Nudge engine — `backend/nudge/`
Evaluates the coach's `nudge_rules` and `motion_rules` against `judge.*`, `metrics.*` and `motion.*`. Rule conditions use a tiny safe evaluator (comparison of one dotted path to a number), never `eval`. Each `nudge` event carries `latency_ms` (end of the wearer's turn → nudge sent) and `budget_left`. Target: slip → phone buzz within 2 s.

**Limiting buzzes** follows the coach's `nudge_policy` (section 4.0):

- Only the **focus rule** buzzes. Every other rule is still evaluated and logged for the debrief, and shown on the laptop as a quiet mark, with no buzz.
- Budget of 5 per session, at least 60 s apart. When the budget is spent the coach goes quiet.
- A metric rule fires only past the wearer's tolerance band (baseline × 1.3), so normal variation does not buzz.
- Fading: when the focus habit has improved over 3 sessions, the next session's budget drops by one; every fifth session is a `silent` session that tracks without buzzing.
- A `success` buzz is sent at most once per session, after a clear win on the focus habit.

**Demo setting:** `min_gap_s` 10 and budget 8, so judges see several nudges in 50 seconds. Say so on stage; the default is the product's real behaviour.

**Two modes:**

| Mode | Coach | Behaviour |
|---|---|---|
| **Regular** | A prebuilt or custom coach | One focus habit, budgeted buzzes, as above |
| **Practice** | The **personal coach**, built from your `HabitProfile` | Buzzes on your own crutch words and recurring issues. Tighter band and a larger budget, because it is a drill, not a real conversation |

### 4.6 Debrief — `backend/debrief/`
On session end, send transcript, metrics, judge aggregates, motion summary, bookmarks, the focus habit and the last session's numbers to Gemini 3.8 Flash with the `Debrief` schema.

- **Spoken recap (about 20 s), in this order:** the most telling fact against the goal ("You asked Sam 0 questions about his trip") → one specific strength → one thing to fix → the fix as an if-then plan. Behaviour only, never a trait. Compared with your own past only.
- **Notes:** a few lines on what was discussed, plus the full transcript.
- **Bookmark review:** each bookmark with its transcript snippet, what happened, and any follow-up it implies.
- **Voice and body timeline:** pace, volume and hand energy every 5 s across the conversation, computed locally, not by the model.
- Reject and regenerate once if the result contains neither a quote nor a number from the session, or if `if_then` does not start with "When" or "If".
- One Aura-2 call for the audio; `debrief.audio_url` points at the saved MP3.
- After the debrief, update the wearer's `HabitProfile` and generate tomorrow's daily mission (section 4.9).
- **"Hear the better version" (Should):** the weakest answer rewritten by Gemini and read aloud. First version uses a stock voice. The cloned-voice version needs an ElevenLabs key and the wearer's recorded consent; do it last.

### 4.7 Coach Studio — `backend/studio/`
`POST /coaches/build {goal}` → Gemini 3.8 Flash returns a `CoachSpec`. Validate it: every rule's `when` must parse, every `haptic` must be a known pattern, question keys must match `[A-Za-z0-9_-]{1,64}`. Two prebuilt coaches ship as JSON: **Interview** and **Listener**. One coach is active per session; keyterms flow into both Deepgram services at session start.

**Personal coach (practice mode).** `backend/studio/personal.py` builds a `CoachSpec` with `kind: "personal"` from the `HabitProfile`: the wearer's top crutch words (most frequent words per minute across sessions that are on a filler/hedge list or far above normal English frequency) become `filler_words` and keyterms, and the most frequent recurring issues become the nudge rules. With no history yet, it falls back to a default profile and says so.

### 4.8 Haptics Connector — `backend/haptics/`, `sdk/`
The band has no vibration motor and iOS Safari cannot vibrate, so the iPhone app is the haptic output. The phone holds a WebSocket to `/ws/device/{device_id}` and plays `HapticCommand`s with `expo-haptics` (sequenced impacts on timers). The app must stay in the foreground; `expo-keep-awake` holds the screen on.

Open API: `POST /v1/apps` registers a third-party app and returns an `app_key`; the user approves it on the phone; `POST /v1/haptics` with `Authorization: Bearer <app_key>` buzzes the phone. `sdk/undertone-haptics.js` wraps it (`Undertone.connect`, `Undertone.buzz`). `sdk/demo/` is a slide-timer page that buzzes the same phone.

### 4.9 Growth and people — `backend/growth/` (daily mission is Must; the rest is Should)

- **Daily mission.** One per day, generated from yesterday's data: the focus habit at yesterday's level plus 10–20%, written as one if-then plan, with 2–3 alternatives the wearer can pick instead. Progress updates after each session.
- **Streak.** Days with at least one coached conversation. One freeze repairs a missed day. No "streak broken" message, ever.
- **History.** Past sessions with headline fact and numbers.
- **People.** Tag who you talked to after a session. A person card shows your pattern with them ("You interrupt Alex 3× more than anyone") and a pre-meeting brief ("Last time you talked 70%. Ask about his trip").
- **Weekly report.** Trends against your own baseline, best conversation, biggest improvement.

All of it is SQLite queries over stored sessions plus one small Gemini call for the wording.

### 4.11 REST surface (all in `backend/main.py`)

| Route | Purpose |
|---|---|
| `WS /ws` | Event bus fan-out to dashboards |
| `WS /ws/device/{device_id}` | Phone connection |
| `POST /session/start`, `/session/stop` | Manual session control |
| `POST /calibration/motion`, `/calibration/swap-speakers` | Calibration |
| `GET /coaches`, `GET /coaches/{id}.json`, `PUT /coaches/{id}` | Coach library |
| `POST /coaches/build`, `POST /coaches/{id}/activate` | Studio |
| `GET /sessions`, `GET /sessions/{id}/debrief` | History; debrief data and audio |
| `POST /session/bookmark` | Bookmark from the phone |
| `GET /profile`, `POST /coaches/personal` | Habit profile; build the personal coach |
| `GET /mission/today`, `POST /mission/choose` | Daily mission |
| `GET /streak`, `GET /report/weekly` | Growth (Should) |
| `GET /people`, `POST /sessions/{id}/person` | People (Should) |
| `POST /pair`, `GET /devices` | Phone pairing (QR payload = `{server_url, device_id, device_token}`) |
| `POST /v1/apps`, `POST /v1/apps/{id}/approve`, `DELETE /v1/apps/{id}`, `POST /v1/haptics` | Haptics Connector |

---

## 5. Screens (built by Antigravity; details in `prompts/antigravity-swarm.md`)

**Dashboard (laptop):** Live (talk-ratio bar, interruption timeline, hand-energy meter, pace, volume, monologue timer, buzz budget) · Studio · Debrief · Pair & devices · Calibration.
**Phone:** Pair · Today (daily mission, streak, pre-meeting brief) · Live (with the bookmark button) · Debrief · History · People · Pattern tester · Connected apps.

Both run on a mock event feed until Claude Code swaps in the real source (section 7).

---

## 6. Schemas

`contracts/events.ts` is the source of truth. Changes from v1:

- Judge answers are typed: `{kind:"noul", p, confidence}`, `{kind:"choice", choice, probabilities, confidence}`, `{kind:"score", score, max, confidence}`.
- New events: `band.status`, `device.status`, `calibration`, `coach.activated`, `app.request`.
- `turn.final` adds `fillers[]`. `metrics` adds `monologue_s`. `nudge` adds `confidence` and `latency_ms`. `debrief` adds `audio_url`.
- Haptic vocabulary: `tap`, `interrupt`, `filler`, `wrap_up`, `slow_down`, `still`, `success`, `approve`, plus three slow, even answers to "How am I doing?": `status_good` (1 buzz), `status_talking` (2), `status_ask` (3).
- From the feature list: `metrics` adds `baseline_wpm`, `volume_db`, `volume_state`, `hand_energy`; new events `signal` (nerves / checked out), `status.reply`, `nudge.snoozed`; `bookmark` gains `source` and `text`; `session.started` gains `mode` and `policy`; `nudge` gains `budget_left`.
- `Debrief` adds `strength`, `if_then`, `notes`, `bookmarks`, `timeline`, `better_version`. `CoachSpec` adds `kind` and `nudge_policy`.
- `nudge.quiet`: a rule fired without buzzing (not the focus habit, or the budget is spent); the laptop shows it as a quiet mark.
- Judge scores are 1-based on the wire (`score` 1..`max`); the Decisions API returns 0-based, the backend adds 1. Rules may also test a choice answer: `judge.tone.probabilities.nervous >= 0.7`.
- `volume_db` is dBFS. The tolerance band applies only to pace against the wearer's baseline; fixed limits are used as written.
- Demo policy (`DEMO_POLICY=1`): every enabled rule may buzz, 10 s apart, budget 8.
- REST types for history and growth: `HabitProfile`, `SessionSummary`, `DailyMission`, `Streak`, `Person`, `WeeklyReport`.

`.env.example` adds `VEXO_BAND_NUMBER` and `BAND_TRANSPORT` and drops `USE_MOCK_BAND`.

---

## 7. Who does what (three people)

| | **Person A — Wearable & hearing** | **Person B — Brain** | **Person C — Experience** |
|---|---|---|---|
| Owns | The physical band. `backend/band/`, `backend/stt/`, `backend/motion/` (incl. hand energy and the nerves / checked-out signals), `backend/session.py` (tap controls), `fixtures/` | `backend/main.py`, `bus.py`, `contracts.py`, `db.py`, `judge/`, `metrics/`, `nudge/` (policy, modes), `debrief/`, `studio/` (incl. personal coach), `growth/` | Antigravity swarm run, `dashboard/`, `mobile/`, `backend/haptics/`, `sdk/`, the iPhone, the demo |
| Tool | Claude Code | Claude Code | Antigravity for the look, then Claude Code for wiring |
| Produces | `turn.final`, `transcript.partial`, `motion`, `band.status`, `bookmark`, session start/stop | `judge`, `metrics`, `nudge`, `debrief`, `coach.activated`, the bus and all coach routes | Working screens, phone haptics, pairing, the connector API and SDK |
| Depends on | Nothing to start | A's `turn.final` (uses a fixture replay until it exists) | B's bus (uses the mock feed until it exists) |

**The seam between the swarm's UI and the live system** is three small files that Claude Code fills in after the UI branch merges:

- `dashboard/lib/bus/socket-source.ts` — real WebSocket source behind the same `useBus()` hook the mock uses.
- `mobile/src/bus/socket-source.ts` — the same for the phone, plus pairing storage.
- `mobile/src/haptics/player.ts` — plays each `HapticPattern` with `expo-haptics`.

**Git:** one repo. A and B work in `backend/` in separate folders and commit to `main` often. C runs the swarm on a `ui` branch and merges when the verifier passes. Only B edits `backend/main.py`; A and C hand B a router to include.

---

## 8. Build order

Times assume about eight hours of building. If you have less, cut from the bottom, never from Phase 1.

### Phase 0 — Together, 45 min
- Create the GitHub repo, push, everyone clones. Copy `.env` by hand (never through git or chat).
- A: clone the kit, connect to band 13, print taps, motion and decoded audio level. Record a 2-minute fixture (PCM + motion CSV) to `fixtures/`.
- B: FastAPI skeleton with `/ws`, `contracts.py`, and `scripts/replay.py` that plays a fixture of events onto the bus. Smoke test: one Decisions call with the ten Core Coach questions, **print the latency**.
- A: smoke test Pipecat + Nova-3 on the laptop mic, print speaker-labelled finals.
- C: check Antigravity `/usage`, launch the swarm with `prompts/antigravity-swarm.md`. Install Expo Go on the iPhone.

**Checkpoint:** four smoke tests pass, swarm is running.

### Phase 1 — Core loop, 2 h → the original MVP works
- A: band → Opus decode → Pipecat (Nova-only) → `turn.final` with `me` / `other`; double-tap start/stop; single tap → "How am I doing?"; volume from PCM; `laptop-mic` and `sim` transports.
- B: metrics (incl. baseline pace) → rule judge → nudge engine with the buzz policy → `nudge` and `status.reply` on the bus; SQLite for sessions and turns; text debrief on session end.
- C: review the swarm's plan and screenshots, steer it. Build `backend/haptics/` (device registry, `/pair`, `/ws/device`, `/v1/haptics`). Buzz the phone from `curl`.

**Checkpoint:** talk into the band, interrupt on purpose, and a `nudge` event appears and the phone buzzes from a script.

### Phase 2 — Smart judge, turns and motion, 1.5 h
- A: add Flux in the `ParallelPipeline` and the turn assembler; motion classifier, hand energy, calibration; the nerves and checked-out signals.
- B: Decisions judge with fallback; confidence thresholds; `latency_ms` on nudges; motion rules; promise → automatic bookmark.
- C: merge the `ui` branch. Wire the three seam files. Live screen and phone now run on the real bus.

**Checkpoint:** the full Live screen works from real speech, with judge tags, confidence and latency showing.

### Phase 3 — Studio, voice and connector, 1.5 h
- B: coach builder, validation, the two prebuilt coaches, activate; full debrief (three-beat recap, notes, bookmark review, timeline) spoken with Aura-2; habit profile, personal coach for practice mode, daily mission.
- A: keyterms from the active coach into both Deepgram services; speaker-swap override; fix whatever the room's acoustics break.
- C: wire Studio, Debrief and Pair screens; connected-apps approval; JS SDK and the `sdk/demo` slide-timer page.

**Checkpoint:** a coach typed live fires its own nudge in the same run, and a separate web page buzzes the phone.

### Phase 4 — Polish, 1 h, then Shoulds in order
Polish the Must list first. Then, only as time allows, one at a time: (1) history and streak, (2) people: tag, person card, pre-meeting brief, (3) weekly report, (4) "Hear the better version" in a stock voice. Stretch after all of that: practice partner as a Pipecat cascade; tap to snooze.

Screens for a Should that has no backend yet stay on sample data and are labelled "sample" on screen. Do not present sample numbers as real in the demo.

### Last hour — freeze
No new features. Rehearse the demo three times in the real room, record a backup video of the full flow, write the Devpost.

---

## 9. Demo script (2 minutes)

1. **(10 s)** "Nobody tells you that you interrupt, ramble or fidget. Undertone does, in the moment."
2. **(50 s)** A teammate wears band 13 and double-taps; the light goes blue. They talk with a judge, interrupt and monologue on purpose. The iPhone buzzes `interrupt`, then `wrap_up`; the screen shows the reason, the confidence and the latency. They fidget while the judge talks → `still`. One single tap: "How am I doing?" → two buzzes, talking too much.
3. **(30 s)** Studio: "What do *you* want to get better at?" Type it, coach appears, activate, 15-second test, the custom nudge fires.
4. **(15 s)** Double-tap to end. Spoken debrief: "You talked 68% of the time and asked one question. Your structure was clear. Next time: when you hit thirty seconds, end with a question." Tomorrow's mission appears on the phone.
5. **(15 s)** Open the slide-timer page. It buzzes the same phone. "Any site or app can now nudge you by touch. The iPhone web cannot do that alone."

---

## 10. Risks and fallbacks

| Risk | Fallback |
|---|---|
| Venue Bluetooth is crowded; audio drops | `BAND_TRANSPORT=serial` over USB; or `laptop-mic` for audio and keep the band for taps and motion |
| Band will not connect | Close the kit's dashboard tab, double-tap, connect within 60 s. One press of RESET. Check Bluetooth permission for the terminal |
| Speaker labels are wrong | Wearer speaks first; loudness cross-check; "swap speakers" button; single-speaker demo mode |
| Flux and Nova clocks do not line up | Stay Nova-only for turns (Phase 1 behaviour) |
| Decisions API slow, over quota or down | Rule judge at 800 ms; screen shows `source: rules` |
| Venue Wi-Fi blocks phone ↔ laptop | Phone hotspot for both, or a `cloudflared` tunnel |
| Phone app goes to background | Keep-awake, and keep the app open on the table during the demo |
| Debrief is generic | Quote-or-number check, regenerate once |
| Swarm output is late or broken | The demo still runs: nudges show in the terminal and the phone buzzes from the backend. A plain one-page event viewer is a 20-minute fallback |
| Swarm burns the Antigravity quota | Check `/usage` first; the prompt caps the worker count; stalled workers need a nudge after quota refresh |
| Laptop disk is nearly full (24 GB free on the build machine) | Clear space before installing Expo and Next.js dependencies |
| API keys were pasted into a chat | Rotate both the Deepgram and Gemini keys after the event |
| The feature list is larger than one day | Tiers in section 1. Phases 1–3 are the Must list; nothing in Phase 4 is allowed to start while a Must is broken |
| The buzz budget makes the demo look quiet | Demo policy (10 s gap, budget 8), stated openly on stage |
| Volume readings drift with room noise | Baseline in the real room during calibration; if unreliable, show volume but do not nudge on it |

---

## 11. Success criteria

- The wearer's voice is labelled correctly most of the time in the real room.
- Slip → iPhone haptic within 2 s, with the measured latency on screen.
- Metrics visibly update during the conversation.
- The debrief quotes or cites specifics from the session.
- A coach built live from a judge's sentence works in the same demo.
- A second, unrelated web page buzzes the phone through the Haptics Connector.

## 12. Not today

Accounts beyond pairing codes, always-on listening, multi-user, payments, Android, App Store distribution, an MCP server, a native Core Haptics module, the memory graph, triple-tap, leaderboards or comparing users with each other, voice cloning without the speaker's recorded consent.
