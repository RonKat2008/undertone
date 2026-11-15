# Undertone backend

FastAPI app that turns conversation events (speech, motion, band taps) into judged turns,
live metrics, budgeted haptic nudges, a spoken debrief, and growth stats.

## 1. Run

```
uv sync
DEV=1 DEMO_POLICY=1 uv run uvicorn backend.main:app --port 8000
# another terminal:
uv run python scripts/ws_tail.py --quiet-metrics
uv run python scripts/replay.py --speed 4
```

- Tests: `uv run pytest -q`
- Decisions smoke test: `uv run python scripts/smoke_decisions.py` (add `--rest` for raw REST via httpx instead of the SDK; `--calls N`).
- Judge eval: `uv run python scripts/eval_judge.py [--rules-only] [--cases PATH]`; `fixtures/judge_cases_holdout.jsonl` is a held-out set for measuring only (do not tune to it).
- Sample history for the demo: `uv run python scripts/seed_sample.py [db_path] [--force] [--today YYYY-MM-DD]`
  writes realistic past sessions (History, People, Today screens) into `UNDERTONE_DB` (or `db_path`). Seeded ids
  start with `sample_`; `--force` replaces only those and keeps real sessions. Needs no `.env` and no keys.
- Python is pinned to 3.13 via `.python-version`.

Env flags (read in `backend/config.py` from the repo-root `.env`; never print key values):

| Var | Meaning |
|-----|---------|
| `GEMINI_API_KEY` | Decisions / Gemini calls (judge, studio, debrief) |
| `DEEPGRAM_API_KEY` | Speech/TTS for the spoken debrief |
| `PUBLIC_BACKEND_URL` | Default `http://localhost:8000` |
| `USE_RULE_JUDGE_ONLY` | Skip Gemini, always use the rule judge |
| `DEMO_POLICY` | Demo override: every enabled rule may buzz (not only the focus rule), min_gap 10 s, budget 8 per session; fading and silent sessions are skipped |
| `DEV` | Enables `POST /dev/publish` |
| `UNDERTONE_DB` | SQLite path (default `undertone.db` at repo root) |
| `UNDERTONE_ENV_FILE` | Extra env file to load; use in git worktrees where `.env` is absent |
| `UNDERTONE_STUDIO_HEDGE` | `2` or `3` races that many coach generations in `POST /coaches/build`; the first valid one wins (cuts the slow tail on stage). Default 1 |

## 2. Layout

Shared core (Person B):
- `main.py` FastAPI app, error envelope, REST + `/ws`; only Person B edits it.
- `contracts.py` pydantic mirror of `contracts/events.ts` (source of truth is the .ts).
- `bus.py` in-process pub/sub; `state.py` AppState / SessionState; `db.py` SQLite; `deps.py` FastAPI deps.
- `brain.py` orchestrator: bus events -> judge -> metrics -> nudge -> haptics; session start/end.
- `config.py` settings; `haptics_port.py` seam to the phone's haptics.

Person B packages:
- `judge/` per-turn verdicts (Decisions API, rule fallback); `judge/core_questions.py` has CORE_QUESTIONS.
- `metrics/` MetricsEngine (talk ratio, wpm, monologue, fillers, timeline).
- `nudge/` NudgeEngine (budget, gap, cooldown, snooze); `nudge/conditions.py` rule evaluator.
- `debrief/` debrief generation, spoken audio, `GET /sessions/{id}/debrief`.
- `studio/` coach library/builder/validation (`prebuilt/*.json`, `default.py`, `routes.py`).
- `growth/` habit profile, daily mission, streak, people, history (`routes.py`).
- `voices/` voice memory: remembers voices across conversations, fixes me/other labels (section 6).

Other: `tests/` (`conftest.py` sets the isolated test env once: temp db, no keys, DEV, DEMO_POLICY, rule judge);
`scripts/` (replay, ws_tail, seed_sample, eval_judge, smoke_decisions, smoke_flash, smoke_tts, try_debrief, try_studio).

## 3. For Person A (band + speech)

Publish on the bus; the brain is already subscribed:

```python
await app_state.bus.publish(TurnFinalEvent(turn_id=..., speaker="me", text=..., start=..., end=..., wpm=..., fillers=[...]))
# a dict also works; it is validated with parse_event
```

`app_state` is `app.state.app` (an `AppState`); the brain is `app.state.brain`.

Events the brain consumes:
- `turn.final`: stored, fed to metrics, saved to the db. Only speaker `"me"` turns are judged; `"other"` turns are context (previous other turn, interruption overlap). Publish at turn end.
- `transcript.partial`: lets `monologue_s` grow before the final turn arrives (speaker `"me"` starts the run, `"other"` resets it).
- `motion`: state (still/gesture/fidget), hand_energy, speaker_context, ts. Fidgeting while `"other"` speaks feeds `motion.fidget_while_other_s`.
- `bookmark`: appended to the session and saved.
- `signal`: appended to the session (nerves / checked_out).
- `band.status` is also accepted on the bus (listed in the brain docstring) but has no brain handler.

Times (`start`, `end`, `ts`) are seconds since session start, i.e. `SessionState.started_at` (`session.now_s()` gives the current value).

Brain methods (`backend/brain.py`):
```python
async def start_session(self, coach_id: str | None = None, mode: SessionMode = "regular") -> str
async def end_session(self) -> DebriefEvent | None
async def single_tap(self) -> StatusReplyEvent | None
async def bookmark(self, source: BookmarkSource, text: str | None = None) -> BookmarkEvent | None
def on_volume(self, db: float, ts: float) -> None
```
`start_session` raises ValueError for an unknown coach; the others return None when no session runs. `single_tap` snoozes a nudge fired within the last 3 s, then replies with a status verdict.

Session start picks the coach and policy:
- **Practice mode** (`mode="practice"`, no `coach_id`): the personal coach, `studio.build_personal_coach(profile)`
  from the stored `HabitProfile` (`growth.current_profile`); a starter coach before any history. An explicit
  `coach_id` wins. Practice keeps the personal coach's own policy (tighter band, budget 8).
- **Regular mode**: the given or active coach. Its policy goes through **fading**,
  `nudge.next_policy(policy, recent_focus_rates, session_index)`: `recent_focus_rates` are the focus rule's firing
  rates (buzzed + quiet, per wearer minute) over the last 3 finished regular sessions with that coach, oldest to
  newest (`growth.focus_rates`); `session_index` is the 1-based index of this session (finished sessions + 1,
  `growth.next_session_index`). Three strictly falling rates drop the budget by one (min 1); every fifth session
  is `silent` (tracked, no buzz). A failure here logs and keeps the coach's policy.
- `DEMO_POLICY` replaces all of this with min_gap 10 s and budget 8 (no fading, never silent).

Do not edit `main.py`. Hand Person B an `APIRouter` to include.

## 4. For Person C (UI + phone)

`WS /ws` streams every bus event as JSON matching `contracts/events.ts` (`type` field discriminates).

- `nudge`: a buzz (focus rule, or any enabled rule under `DEMO_POLICY`), with `latency_ms` and `budget_left`.
- `nudge.quiet` `{rule_id, haptic, message, reason, ts}`: a rule fired but did not buzz (not the focus rule, budget
  spent, too soon after the last buzz, snoozed, a silent session, or another rule buzzed at that moment). Show it as a quiet mark on the laptop; it is
  stored with the nudges so the habit profile and fading count silent slips too.
- `debrief` arrives in **two steps with the same `session_id`**: first the text (`audio_url: null`) right after
  the session ends (also the body of `POST /session/stop`), then a second `debrief` event with `audio_url` set once
  the spoken MP3 is ready (a few seconds later). No second event if speech fails or no Deepgram key is set.
  Replace the first by `session_id`; `GET /sessions/{id}/debrief` returns the latest stored version.

REST routes:

| Method | Path | Notes |
|--------|------|-------|
| GET | `/health` | session_id, active_coach, subscribers, gemini/deepgram flags, rule_judge_only, demo_policy, dev |
| POST | `/session/start` | body `{coach_id?, mode?: "regular"\|"practice"}`; 404 on unknown coach |
| POST | `/session/stop` | returns debrief; 409 if no session |
| POST | `/session/bookmark` | body `{text?, source?: "phone"\|"promise"}`; 409 if no session |
| POST | `/session/tap` | returns `status`; 409 if no session |
| POST | `/dev/publish` | `DEV=1` only; injects one validated bus event |
| GET | `/coaches` | list |
| GET | `/coaches/{id}.json` | one coach; optional `?first_language_family=romance\|sinitic\|japanese_korean\|slavic\|south_asian\|arabic\|germanic` adds judge examples (Clear Across) |
| PUT | `/coaches/{id}` | validated save |
| POST | `/coaches/build` | body `{goal}` |
| POST | `/coaches/{id}/activate` | |
| POST | `/coaches/personal` | |
| GET | `/profile`, `/mission/today`, `/streak`, `/report/weekly`, `/people`, `/sessions` | growth |
| POST | `/mission/choose` | body `{focus_rule_id}` |
| POST | `/sessions/{id}/person` | body `{name, person_id?}` |
| GET | `/sessions/{id}/debrief` | `{session_id, data, audio_url}` |
| GET | `/graph?days=30`, `/graph/node/{id}?days=30`; POST `/graph/refresh` | knowledge graph (`graph/`): `KnowledgeGraph` / `GraphNodeDetail` (404 unknown id); an empty db gives just the `me` node (`sample` is always false); topics cached per session in `session_topics` (LLM, keyword fallback) and merged onto one canonical label (`topic_aliases`); refresh runs lazily after `GET /graph` |
| POST | `/graph/commitment/{id}` | body `{open: bool}` (false = done); id `commitment:<n>` or `<n>`; returns `CommitmentStatus`; 404 if not a promise; a manual state wins over the automatic check |
| GET | `/reports/overview`, `/reports/by-person`, `/reports/person/{id}`, `/reports/by-topic`, `/reports/topic/{id}`, `/reports/habits`, `/reports/promises` (all `?days=30`) | reports (`reports/`), see below |
| GET | `/media/*` | static files (debrief MP3s) |

### Reports (`backend/reports/`)

Data for the future Reports tab. Kept conversations only; windows are whole UTC days (the last `days`
days including today) compared with the previous equal window, or the wearer with one person / on one
topic against the wearer's own other conversations in the window. Never another user. No LLM, no
writes, no background work on a report GET; about 13-24 ms each on the seeded sample database.

| Endpoint | Response | Notes |
|---|---|---|
| `/reports/overview` | `OverviewReport` | totals, `measures` (`ReportDelta` per measure), habits with best/weakest, promise counts, top people/topics, `by_relationship`, a `series` point per day, up to 3 `highlights` |
| `/reports/by-person` | `ByPersonReport` | one `PersonReportSummary` per person: comparisons, ready `sentence`, relationship kind/confidence/source |
| `/reports/person/{id}` | `PersonReport` | `id` or `person:<id>`; topics, promises, habits, timeline; 404 if unknown |
| `/reports/by-topic` | `ByTopicReport` | one `TopicReportSummary` per topic: people, trend, comparisons, sentence |
| `/reports/topic/{id}` | `TopicReport` | slug or `topic:<slug>`; weekly series, tied promises, the wearer's quotes, timeline; 404 if in neither window |
| `/reports/habits` | `HabitsReport` | per habit: buzzed/quiet, trend, weekly series, by person/topic, the debriefs' if-then plans |
| `/reports/promises` | `PromisesReport` | open (oldest first) and done, with person, quote, conversation, age, `due_day`, `overdue` |

Every response has `graph_focus: {node_ids, edges}` with ids of `GET /graph?days=<same>` to highlight.
Small samples: rates compare windows only with at least 3 conversations in each (counts need one before);
a person or topic comparison needs 3 conversations on each side, a ratio of at least 1.25 (or at most
0.8) and a per-measure absolute gap before it is `meaningful` or gets a sentence; a habit trend also
needs 3 hits across both windows. Below that, numbers are `null` / `insufficient_data`, never zero.

Error envelope for all errors: `{"ok": false, "error": {"code": "...", "message": "...", "details"?: ...}}`.
Codes: `http_<status>`, `invalid_request` (422), `invalid_event` (422), `internal` (500), and studio's
`invalid_coach` / `invalid_goal` (422) / `invalid_built_coach` (500) with `details: {"errors": [str]}`.
An `HTTPException` with a dict detail sets `code`/`message` from its `code`/`message` keys and keeps the other
keys as `details`; a list detail becomes `details`; a str detail is the message.

Haptics: call `haptics_port.register_sender(async_fn)` once at startup; `async_fn(cmd: HapticCommand)`
(fields: pattern, intensity, label, source_app) delivers to the paired phone. The brain calls
`haptics_port.send` for every buzzed nudge (pattern = nudge haptic, label = nudge message) and for
every tap status reply (pattern = reply haptic, label = verdict). Until a sender is registered it only logs;
`send` never raises.

## 5. Package workers

Frozen public signatures (copied from each module docstring):

```python
# judge
async def judge_turn(ctx: TurnContext, coach: CoachSpec) -> JudgeEvent
def rule_judge(ctx: TurnContext, coach: CoachSpec) -> dict[str, JudgeAnswer]
def format_input(ctx: TurnContext) -> str
CORE_QUESTIONS  # backend/judge/core_questions.py
# judge_turn never raises and returns within ~800 ms; falls back to rule_judge (source "rules")

# metrics
class MetricsEngine:
    def __init__(self, baseline_wpm: float | None, baseline_volume_db: float | None, filler_words: list[str]) -> None
    def add_turn(self, turn: TurnFinalEvent) -> None
    def add_partial(self, partial: TranscriptPartialEvent, now: float) -> None
    def add_motion(self, motion_event: MotionEvent) -> None
    def add_volume(self, db: float, ts: float) -> None
    def note_judge(self, judge_event: JudgeEvent) -> None
    def snapshot(self, now: float) -> Metrics
    def timeline(self) -> list[TimelinePoint]

# nudge
class NudgeEngine:
    def __init__(self, coach: CoachSpec, policy: NudgePolicy) -> None
    def evaluate(self, judge: JudgeEvent | None, metrics: Metrics, motion_state: MotionSnapshot | None,
                 now: float, slip_ts: float) -> NudgeEvent | None
    def status_reply(self, metrics: Metrics, now: float) -> StatusReplyEvent
    def snooze(self, rule_id: str, now: float) -> None
    budget_left: int          # property
    quiet_marks: list[QuietMark]   # property
def evaluate_condition(expr: str, env: dict) -> bool   # nudge/conditions.py
def parse_condition(expr: str) -> Condition            # raises ConditionError

# debrief
async def generate_debrief(session: SessionState, metrics: Metrics, timeline: list[TimelinePoint],
                           last: SessionSummary | None) -> Debrief   # never raises
async def speak(text: str, session_id: str) -> str | None  # MP3 at MEDIA_DIR/{id}.mp3 -> "/media/{id}.mp3"; max 2000 chars
def spoken_text(debrief: Debrief) -> str
router: APIRouter   # GET /sessions/{id}/debrief

# studio
async def build_coach(goal: str) -> CoachSpec
def validate_coach(spec: CoachSpec) -> list[str]        # [] means valid
def load_prebuilt() -> list[CoachSpec]
def build_personal_coach(profile: HabitProfile) -> CoachSpec
def default_coach() -> CoachSpec
router: APIRouter

# growth
def update_profile(db: DB, session: SessionState, metrics: Metrics) -> HabitProfile
def mission_for_today(db: DB) -> DailyMission
def streak(db: DB) -> Streak
router: APIRouter
```

Rules: do not change these signatures or `contracts.py`; propose changes to Person B. Private modules
inside your own package are fine. Several bodies are still stubs (judge uses rules only, debrief is a local
template and `speak` returns None, studio does not call Gemini); the worker fills in the bodies only.

Nudge condition grammar (`<dotted.path> <op> <number|'string'|true|false>`, op in `>= <= > < == !=`;
missing path or invalid expression evaluates False, never raises; no eval/exec):

```
judge.interrupted.p >= 0.8        judge.question_type.choice == 'none'     judge.clarity.score < 2
metrics.monologue_s > 45          motion.fidget_while_other_s > 8          motion.state == 'fidget'
```

Env shape: `{"judge": {qid: answer.model_dump()}, "metrics": Metrics.model_dump(),
"motion": MotionSnapshot.model_dump()}`. So `judge.<qid>.p` (noul), `.choice` (choice), `.score` (score: the
expected level, **1-based**, 1 = the first (worst) criterion .. `max` = number of levels; may be fractional),
plus `metrics.*` (talk_ratio, interruptions, questions, fillers_per_min, wpm, monologue_s, volume_db, ...)
and `motion.*` (state, hand_energy, speaker_context, confidence, fidget_while_other_s, ts).

## 6. Voice memory (`backend/voices/`)

Remembers voices across conversations. Runs after a conversation closes (once its keep verdict is
stored), in a worker thread, never on the live audio path; any failure is logged and recorded as the
run's status and never touches session end, the debrief or the verdict.

What happens per conversation: the saved WAV is cut into stretches of speech using Deepgram's final
word timings (kept per conversation via `SessionController.on_final_words`; whole-turn 3 s windows when
none exist), short neighbours are pooled, each stretch is embedded (NeMo TitaNet-small via sherpa-onnx,
CPU), and the embeddings are clustered within the conversation (Deepgram labels only as a small
tie-break, so two voices under one label are still separated). The cluster matching the wearer
voiceprint is "me", every other cluster "other". The stored turns are corrected: speaker labels fixed,
a turn holding both voices split at the word where the voice changes (`<turn_id>.1`, `.2`, ...).
Every other cluster is matched to stored voiceprints (cosine >= `match_sim` 0.55 and >= `match_margin`
0.1 over the second best): a match auto-tags the conversation with that person and adds an exemplar;
no match creates "Unknown voice N" (person `voice-N`), so the next conversation links up before a name
exists. Voiceprints keep up to 20 exemplars; the centroid is their robust mean (an outlier sample is
rejected), so one bad sample cannot poison it. A name heard in the transcript (one Gemini call; rules
for "Hello, Dylan" / "I'm Dylan" when unavailable; never a guess, never the wearer's name) names an
unnamed voice or confirms a named one; a different name is recorded as a conflict, not applied.
`POST /sessions/{id}/person` also attaches that conversation's other voice to the person (merging it into
that person's voice when they already have one) and always wins: the tag is recorded as manual (also with
`VOICE_MEMORY=0`), and on first start every conversation already tagged is recorded as manual.
Reprocessing (`POST /voices/reprocess`) takes the conversation's samples out of every voiceprint and its
voice-set tag off first, then redoes it from the original turns; an exemplar that conversation evicted
from a full (20) print is not restored. Changing `VOICE_MODEL` makes old voiceprints incomparable: they
are ignored (shown, never matched), and the wearer bootstraps again unless re-enrolled.

Recomputed after a correction: `metrics_json` talk_ratio / wpm / fillers_per_min / monologue_s, the
summary's talk_ratio / wpm / fillers_per_min, the habit profile and people cards. Not recomputed:
interruptions and questions (from live judge results), volume, hand energy, the debrief text and its
numbers, judge results; nudges and haptics already fired live cannot be undone.
`GET /sessions/{id}/voices` lists exactly what was done for one conversation.

The wearer: enrol with `POST /voices/wearer/enrol {"seconds": 15}` (speak alone right after calling it;
the band must be streaming: ALWAYS_ON or a session) or `POST /voices/wearer/enrol/wav` with a 16 kHz
mono 16-bit WAV body (`curl --data-binary @me.wav -H 'Content-Type: audio/wav'`). `DELETE /voices/wearer`
clears it. Not enrolled: the loudest cluster (>= 3 dB above the next; the band is on the wearer's wrist)
becomes a *provisional* wearer print; labels are corrected only when that print and the loudness pick
agree, and after 3 such conversations the print is confirmed and earlier conversations are redone. Risk:
someone consistently louder than the wearer can be taken for the wearer; enrolment removes the risk.

Routes: `GET /voices`, `GET|POST name|POST merge|DELETE /voices/{id}`, `GET /sessions/{id}/voices`,
`GET|DELETE /voices/wearer`, `POST /voices/wearer/enrol[/wav]`, `POST /voices/reprocess {"session_ids"?}`
(payloads in `contracts/events.ts`, "voice memory").

Privacy and control: `VOICE_MEMORY=0` turns the feature off entirely (no words kept, no model loaded,
routes answer "off"; only the manual-tag record above is still written). Voiceprints are float32 arrays in the local SQLite file only (`voice_*` tables),
never sent anywhere and never in an API payload. Conversations judged 'sensitive' or 'noise' are not
used. Forgetting a voice (`DELETE /voices/{id}`) deletes its voiceprint, exemplars and per-conversation
embeddings (a named person card stays; an "Unknown voice" person goes).
Model: `VOICE_MODEL` (default `titanet-small`, 40 MB, CC BY 4.0), fetched on first use from the pinned
sherpa-onnx release URL, sha256-checked, into `VOICE_MODEL_DIR` (default `.undertone/models`, git-ignored);
`VOICE_MODEL_DOWNLOAD=0` forbids the download. Missing model or package: logged, old behaviour.
Evaluate: `uv run --env-file ../.env python scripts/voice_eval_data.py` then `python scripts/eval_voices.py`.

## 7. Decisions API notes (verified live)

- `client.decisions.create(model="gemini-decision-1", input=str, questions={qid: CoachQuestion.model_dump()})` accepts plain dicts; each question needs a `type` key.
- Response `answers[qid]` has `.type`:
  - `'noul'`: `.noul`, `.confidence`
  - `'choice'`: `.choice`, `.probabilities`, `.confidence`
  - `'score'`: `.score` (0-based expected level in the raw SDK response), `.probabilities` keyed "0"..., `.legend`, `.confidence`.
    `judge/decisions.py` adds 1, so `ScoreAnswer.score` on the wire and in nudge conditions is 1-based (1..max).
- Async: `client.aio.decisions.create(..., timeout=seconds)`.
- The SDK retries 429/5xx up to 4 times by default, so the judge must enforce its own 800 ms `asyncio` timeout.
- A choice question with fewer than 2 options returns HTTP 400 "must have between 2 and 255 options".
- Latency: warm about 215-270 ms for the ten core questions (~1.5K input tokens); first call about 500-900 ms.
