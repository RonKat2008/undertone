/**
 * Undertone wire contract. Source of truth for every message on the event bus
 * and every REST payload.
 * Backend (Python) mirrors these as pydantic models in backend/contracts.py.
 * Dashboard and mobile copy this file verbatim (do not edit the copies).
 * Change a shape here first, note it in plan.md section 6, then update consumers.
 *
 * All `ts`, `t`, `start`, `end` values are seconds since session start.
 */

export type Speaker = 'me' | 'other';
export type MotionState = 'still' | 'gesture' | 'fidget';
export type JudgeSource = 'decisions' | 'rules';
export type BandTransport = 'ble' | 'serial' | 'sim' | 'laptop-mic';
export type SessionMode = 'regular' | 'practice';
export type VolumeState = 'quiet' | 'ok' | 'loud';

export type HapticPattern =
  // nudges
  | 'tap' // 1 light tick: generic / acknowledged
  | 'interrupt' // 2 sharp heavy taps: you cut them off -> "let them finish"
  | 'filler' // 1 short medium: filler word or hedge -> "pause"
  | 'wrap_up' // 3 rising taps: talking too long -> "ask a question"
  | 'slow_down' // long soft ramp: too fast -> "slow down"
  | 'still' // 2 soft slow pulses: hands / fidget -> "hands calm"
  | 'success' // bright double: a clear good moment (used rarely)
  | 'approve' // selection tick x2: something is waiting for approval
  // answers to a single tap, "How am I doing?": slow, even, long buzzes
  | 'status_good' // 1 buzz: good
  | 'status_talking' // 2 buzzes: talking too much
  | 'status_ask'; // 3 buzzes: ask a question

/** One answer from the judge. `confidence` is 0-1: probability the top answer is right. */
export type JudgeAnswer =
  | { kind: 'noul'; p: number; confidence: number }
  | { kind: 'choice'; choice: string; probabilities: Record<string, number>; confidence: number }
  | { kind: 'score'; score: number; max: number; confidence: number }; // score is 1-based: 1..max

export interface Metrics {
  talk_ratio: number; // 0-1, share of speaking time that is the wearer's
  interruptions: number;
  questions: number;
  fillers_per_min: number;
  wpm: number; // wearer's rolling pace
  baseline_wpm: number | null; // the wearer's own usual pace
  monologue_s: number; // length of the wearer's current uninterrupted run
  volume_db: number; // wearer's rolling loudness in dBFS (0 = full scale, about -60 = silence)
  volume_state: VolumeState;
  hand_energy: number; // 0-1: 0 frozen, ~0.5 natural gesturing, 1 overdoing it
}

export interface BookmarkReview {
  ts: number;
  source: 'phone' | 'promise'; // tapped on the phone, or the judge heard a promise
  snippet: string; // transcript around the moment
  what_happened: string;
  follow_up: string | null; // e.g. "Send Sam the deck"
}

export interface TimelinePoint {
  t: number;
  wpm: number;
  volume_db: number;
  hand_energy: number;
}

/** Order matters: it is the order the debrief is read aloud. */
export interface Debrief {
  headline_fact: string; // the most telling fact, compared with the goal
  strength: string; // one specific, real strength; never generic praise
  one_fix: string; // one behaviour, described as behaviour, never as a trait
  if_then: string; // the fix as a plan: "When you hit 30 seconds, end with a question"
  numbers: Pick<Metrics, 'talk_ratio' | 'interruptions' | 'questions' | 'fillers_per_min' | 'wpm'>;
  best_moment_quote: string;
  vs_last_time: string | null; // compared with the wearer's own past only
  notes: string[]; // short notes on what was discussed
  bookmarks: BookmarkReview[];
  timeline: TimelinePoint[]; // pace, volume and hand energy across the conversation
  better_version: { original: string; rewritten: string; audio_url: string | null } | null; // "Hear the better version"
}

export type CoachQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };

export interface NudgeRule {
  id: string;
  when: string; // e.g. "judge.interrupted.p >= 0.8" or "metrics.monologue_s > 45"
  haptic: HapticPattern;
  message: string; // an action ("Let them finish"), never a judgement
  cooldown_s?: number;
  enabled?: boolean;
}

/** How sparingly the coach buzzes. See plan.md section 4.0 and 4.5. */
export interface NudgePolicy {
  focus_rule_id: string; // regular mode: always the pace rule; practice mode: the drill focus
  budget_per_session: number; // regular mode: 3 (pace only); practice mode: no cap within a round
  min_gap_s: number; // regular mode: 120 (demo: 30)
  tolerance: number; // regular mode pace: 0.25, buzz only beyond baseline_wpm * (1 + tolerance)
  silent: boolean; // a no-buzz session: tracked, not nudged
}

export interface CoachSpec {
  id: string;
  name: string;
  goal: string;
  kind: 'prebuilt' | 'custom' | 'personal'; // personal = built from the wearer's own habit profile
  confidence_threshold: number; // the Studio sensitivity slider maps onto this
  keyterms: string[];
  filler_words: string[];
  questions: Record<string, CoachQuestion>;
  nudge_rules: NudgeRule[];
  motion_rules: NudgeRule[];
  nudge_policy: NudgePolicy;
  debrief_rubric: string;
  drill: { partner_persona: string; prompts: string[] };
}

export type BusEvent =
  | { type: 'band.status'; connected: boolean; transport: BandTransport; battery_pct: number | null; mic_on: boolean }
  | { type: 'device.status'; device_id: string; name: string; connected: boolean }
  | { type: 'session.started'; session_id: string; coach_id: string; mode: SessionMode; policy: NudgePolicy; ts: 0 }
  | { type: 'calibration'; kind: 'speaker' | 'motion' | 'baseline'; step: string; done: boolean }
  | { type: 'transcript.partial'; speaker: Speaker | null; text: string }
  | { type: 'turn.final'; turn_id: string; speaker: Speaker; text: string; start: number; end: number; wpm: number; fillers: string[] }
  | { type: 'motion'; state: MotionState; hand_energy: number; speaker_context: Speaker | null; confidence: number; ts: number }
  | { type: 'judge'; turn_id: string; results: Record<string, JudgeAnswer>; latency_ms: number; source: JudgeSource }
  | ({ type: 'metrics' } & Metrics)
  | { type: 'signal'; kind: 'nerves' | 'checked_out'; detail: string; ts: number } // voice and body together
  | { type: 'nudge'; rule_id: string; haptic: HapticPattern; message: string; reason: string; confidence: number | null; latency_ms: number; budget_left: number; ts: number }
  | { type: 'nudge.quiet'; rule_id: string; haptic: HapticPattern; message: string; reason: string; ts: number } // a rule fired but did not buzz: shown as a quiet mark
  | { type: 'nudge.snoozed'; rule_id: string; ts: number } // stretch: single tap within 3 s of a nudge
  | { type: 'status.reply'; verdict: 'good' | 'talking_too_much' | 'ask_question'; haptic: HapticPattern; ts: number } // single tap
  | { type: 'bookmark'; source: 'phone' | 'promise'; text: string | null; ts: number }
  | { type: 'session.ended'; session_id: string }
  | { type: 'debrief'; session_id: string; data: Debrief; audio_url: string | null }
  | { type: 'coach.activated'; coach: CoachSpec }
  | { type: 'app.request'; app_id: string; name: string }; // third-party app asking to buzz the phone

/** Backend -> phone over /ws/device/{device_id}. */
export interface HapticCommand {
  type: 'haptic';
  pattern: HapticPattern;
  intensity: number; // 0-1
  label: string;
  source_app: string; // "undertone" or a registered third-party app name
}

// ---------- REST payloads: history, growth, people ----------

/** The wearer's own recurring habits, learned from past sessions. Drives practice mode. */
export interface HabitProfile {
  sessions: number;
  baseline_wpm: number | null;
  baseline_volume_db: number | null;
  crutch_words: { word: string; per_min: number }[];
  recurring_issues: { rule_id: string; label: string; rate: number; trend: 'better' | 'same' | 'worse' }[];
}

export interface SessionSummary {
  session_id: string;
  started_at: string; // ISO
  duration_s: number;
  coach_name: string;
  mode: SessionMode;
  person_id: string | null;
  headline_fact: string;
  numbers: Debrief['numbers'];
  kept?: boolean; // worth keeping (GET /sessions lists only kept ones unless ?include=all)
  kept_reason?: string | null; // 'keep' | 'trivial' | 'noise' | 'sensitive'; null = not classified yet
  audio_url?: string | null; // '/sessions/{id}/audio' when a recording exists
}

// ---------- REST payloads: transcript (GET /sessions/{id}/transcript) ----------

export interface TranscriptTurn {
  turn_id: string;
  speaker: 'me' | 'other';
  text: string;
  start: number; // seconds from the start of the conversation
  end: number;
  wpm: number;
  fillers: string[];
}

export interface SessionTranscript {
  session_id: string;
  started_at: string; // ISO
  duration_s: number | null; // null while the conversation is still open
  audio_url: string | null; // GET it with Range requests (audio/wav); null when there is no recording
  audio_offset_s: number; // add to a turn's start to get its position in the audio file
  turns: TranscriptTurn[]; // oldest first
}

export interface DailyMission {
  date: string; // ISO date
  focus_rule_id: string;
  text: string; // specific, near-term, slightly hard: "Ask 3 open questions before your second story"
  if_then: string; // one plan tied to a cue
  target: number;
  progress: number;
  done: boolean;
  suggestions: { focus_rule_id: string; text: string }[]; // 2-3 options; the wearer chooses
}

export interface Streak {
  days: number; // days with at least one coached conversation (practice days, not perfect days)
  freeze_available: boolean; // a missed day can be repaired
  week: boolean[]; // last 7 days
}

export interface Person {
  person_id: string;
  name: string;
  sessions: number;
  pattern: string; // "You interrupt Alex 3x more than anyone"
  brief: string; // pre-meeting brief: "Last time you talked 70%. Ask about his trip."
}

export interface WeeklyReport {
  week_of: string;
  trend: { metric: keyof Debrief['numbers']; from: number; to: number }[]; // against own baseline
  best_session_id: string | null;
  biggest_improvement: string;
}

// ---------- REST payloads: knowledge graph (GET /graph, GET /graph/node/{id}) ----------
// Times are unix seconds. Node ids are stable and kind-prefixed: 'me', 'person:<id>',
// 'topic:<slug>', 'commitment:<id>', 'habit:<rule_id>', 'conversation:<session_id>'.

export type GraphNodeKind = 'me' | 'person' | 'topic' | 'commitment' | 'habit' | 'conversation';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  weight: number;
  last_seen: number | null;
  meta: Record<string, string | number | boolean | null>;
}

export type GraphEdgeKind = 'talked_with' | 'about' | 'promised' | 'showed' | 'part_of';

export interface GraphEdge {
  source: string;
  target: string;
  kind: GraphEdgeKind;
  weight: number;
}

export interface GraphStats {
  conversations: number;
  people: number;
  topics: number;
  minutes_spoken: number;
  open_commitments: number;
}

export interface KnowledgeGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  stats: GraphStats;
  generated_at: number;
  sample: boolean; // always false: an empty database gives just the 'me' node and zero stats
}

export interface GraphQuote {
  session_id: string;
  ts: number;
  speaker: 'me' | 'other';
  text: string;
}

export interface GraphNodeDetail {
  node: GraphNode;
  neighbours: GraphNode[];
  conversations: SessionSummary[];
  quotes: GraphQuote[];
}

// ---------- REST payloads: voice memory (backend/voices) ----------
// GET /voices -> VoiceList; GET /voices/{id} -> VoiceSummary; POST /voices/{id}/name {name};
// POST /voices/{id}/merge {into}; DELETE /voices/{id}; GET /sessions/{id}/voices -> SessionVoices;
// GET|DELETE /voices/wearer, POST /voices/wearer/enrol {seconds}, POST /voices/wearer/enrol/wav
// (audio/wav body) -> WearerVoice; POST /voices/reprocess {session_ids?} -> ReprocessResult.
// Voiceprints never leave the server: none of these payloads carries an embedding.

export type WearerState = 'none' | 'provisional' | 'confirmed' | 'enrolled';
export type VoiceDecision = 'wearer' | 'matched' | 'new' | 'weak' | 'manual';
export type VoiceRunStatus = 'pending' | 'done' | 'skipped' | 'failed' | 'off';
export type NameOutcome = 'named' | 'confirmed' | 'conflict' | 'ignored';

export interface VoiceConflict {
  session_id: string;
  voice_name: string | null;
  heard_name: string;
  created_at: string; // ISO
}

export interface VoiceSummary {
  voice_id: string;
  person_id: string | null; // 'voice-<n>' while unnamed
  name: string; // or 'Unknown voice <n>'
  named: boolean;
  has_voiceprint: boolean;
  samples: number;
  seconds: number;
  last_heard: string | null; // ISO
  sessions: string[]; // newest first
  conflicts: VoiceConflict[];
}

export interface WearerVoice {
  state: WearerState;
  has_voiceprint: boolean;
  samples: number;
  seconds: number;
  last_heard: string | null;
}

export interface VoiceList {
  enabled: boolean;
  model: string | null;
  wearer: WearerVoice;
  voices: VoiceSummary[];
}

export interface SessionSpeaker {
  voice_id: string | null; // 'wearer' for the wearer
  person_id: string | null;
  name: string | null;
  role: Speaker;
  decision: VoiceDecision;
  similarity: number | null;
  margin: number | null;
  seconds: number;
}

export interface SessionNameGuess {
  name: string;
  source: string; // 'llm' | 'rules'
  evidence: string;
  confidence: number;
  outcome: NameOutcome;
}

export interface SessionVoices {
  session_id: string;
  status: VoiceRunStatus;
  reason: string | null;
  processed_at: string | null;
  model: string | null;
  wearer_source: string | null;
  wearer_similarity: number | null;
  labels_corrected: boolean;
  turns_relabelled: number;
  turns_split: number;
  words_used: boolean;
  speakers: SessionSpeaker[];
  name_guess: SessionNameGuess | null;
  conflicts: VoiceConflict[];
  recomputed: string[];
  not_recomputed: string[];
}

export interface ReprocessResult {
  queued: string[];
  skipped: string[];
}


// ---------- REST payloads: relationships (GET /relationships, /people/{id}/relationship) ----------
// friend/partner/family: personal ties. boss: they manage me; report: I manage them;
// coworker: same team or company, no clear lead. client: I serve them; service: they serve me
// (shop staff, waiter). teacher: they teach me; student: I teach them. acquaintance: some shared
// history; stranger: none. unknown: not enough speech yet, or mixed signals.
export type RelationshipKind = 'friend' | 'partner' | 'family' | 'boss' | 'report' | 'coworker' | 'client' | 'teacher' | 'student' | 'service' | 'acquaintance' | 'stranger' | 'unknown';
export type RelationshipFormality = 'casual' | 'neutral' | 'formal';
export type RelationshipPower = 'they_lead' | 'peer' | 'i_lead' | 'unknown';
export type RelationshipSource = 'decisions' | 'rules' | 'user'; // user = set by the wearer, confidence 1

export interface Relationship {
  person_id: string;
  kind: RelationshipKind;
  confidence: number; // 0-1
  formality: RelationshipFormality;
  power: RelationshipPower;
  warmth: number; // 0-1
  evidence: string[]; // at most 3 short reasons, never quoted speech: "they assign you tasks"
  source: RelationshipSource;
  based_on_sessions: number;
  updated_at: number | null; // unix seconds; null = not analysed yet
}

export interface PersonRelationship {
  person_id: string;
  name: string;
  sessions: number; // kept conversations with this person
  relationship: Relationship;
}

// PUT /people/{id}/relationship body
export interface RelationshipUpdate {
  kind: RelationshipKind;
}

// POST /graph/commitment/{id} (id: 'commitment:<bookmark_id>' or '<bookmark_id>'), body CommitmentUpdate.
export interface CommitmentUpdate {
  open: boolean; // false = done, true = reopened
}

export type CommitmentClosedBy = 'manual' | 'auto';

export interface CommitmentStatus {
  id: string;
  bookmark_id: number;
  open: boolean;
  closed_by: CommitmentClosedBy | null;
  closed_at: number | null;
  closed_session_id: string | null; // the later conversation that closed it (auto only)
  evidence: string | null; // the wearer's words that closed it (auto only)
}

// ---------- REST payloads: reports (GET /reports/*?days=30) ----------
// Kept conversations only. Times are unix seconds, days are UTC 'YYYY-MM-DD'. Every report carries a
// graph_focus: node ids (same ids as GET /graph) and edges to highlight on the map. A null number or
// 'insufficient_data' means too little data, never zero.

export type ReportMeasure =
  | 'conversations' | 'minutes_spoken' | 'talk_ratio' | 'wpm' | 'fillers_per_min'
  | 'interruptions' | 'questions' | 'habit_per_conversation';
export type ReportDirection = 'up' | 'down' | 'same' | 'insufficient_data';
export type ReportHighlightKind =
  | 'improved' | 'slipped' | 'person' | 'habit' | 'promises' | 'topic' | 'insufficient_data';

export interface ReportWindow {
  days: number;
  start: number; // window is [start, end]
  end: number;
  previous_start: number; // previous equal window is [previous_start, start)
}

export interface ReportDelta {
  metric: ReportMeasure;
  current: number | null;
  previous: number | null;
  change: number | null; // current - previous; null when the sample is too small
  direction: ReportDirection;
  better: boolean | null; // null when the measure has no better direction or data is insufficient
  sample: number; // conversations behind current
  previous_sample: number;
}

export interface ReportDayPoint {
  day: string;
  conversations: number;
  minutes_spoken: number;
  talk_ratio: number | null;
  wpm: number | null;
  fillers_per_min: number | null;
  interruptions: number;
  questions: number;
  nudges: number;
  quiet_marks: number;
}

export interface ReportBucket {
  start: string; // first day of the bucket
  days: number;
  count: number;
}

export interface ReportRank {
  node_id: string;
  label: string;
  conversations: number;
  minutes: number; // conversation minutes (both speakers)
}

export interface ReportCount {
  node_id: string;
  label: string;
  count: number;
}

export interface ReportComparison {
  metric: ReportMeasure;
  value: number | null; // the wearer in these conversations
  usual: number | null; // the wearer in all their other conversations in the window
  ratio: number | null; // value / usual; null unless both samples are big enough
  sample: number;
  usual_sample: number;
  meaningful: boolean; // big enough samples and a clear difference
}

export interface ReportHighlight {
  kind: ReportHighlightKind;
  text: string;
  node_ids: string[];
}

export interface GraphFocusEdge {
  source: string;
  target: string;
}

export interface GraphFocus {
  node_ids: string[];
  edges: GraphFocusEdge[];
}

export interface ReportTotals {
  conversations: number;
  minutes_spoken: number; // the wearer's own speaking minutes
  minutes_together: number; // conversation length
  interruptions: number;
  questions: number;
  nudges: number; // buzzed
  quiet_marks: number;
}

export interface ReportPromiseCounts {
  made: number;
  open: number;
  done: number;
  overdue: number;
}

export interface ReportHabitCount {
  rule_id: string;
  node_id: string;
  label: string;
  total: number;
  buzzed: number;
  quiet: number;
  conversations: number; // conversations it showed up in
  per_conversation: number | null; // across all conversations in the window
  trend: ReportDelta;
}

export interface ReportConversation {
  session_id: string;
  node_id: string;
  started_at: number;
  minutes: number;
  minutes_spoken: number;
  talk_ratio: number;
  wpm: number;
  fillers_per_min: number;
  interruptions: number;
  questions: number;
  headline: string;
  person_node_id: string | null;
  topic_ids: string[]; // topic node ids
}

export interface ReportPromise {
  id: string; // commitment node id
  bookmark_id: number;
  text: string;
  quote: string | null;
  person_id: string | null;
  person_name: string | null;
  person_node_id: string | null;
  session_id: string;
  conversation_node_id: string;
  made_at: number;
  age_days: number;
  open: boolean;
  closed_by: CommitmentClosedBy | null;
  closed_at: number | null;
  closed_session_id: string | null;
  evidence: string | null;
  due_day: string | null; // only when the promise names a clear day ("by Friday", "tomorrow")
  overdue: boolean;
}

export interface ReportQuote {
  session_id: string;
  ts: number;
  text: string;
}

export interface ReportRelationshipGroup {
  kind: RelationshipKind; // people never analysed are grouped under 'unknown'
  people: number;
  conversations: number;
  minutes: number;
  node_ids: string[]; // person node ids
}

// GET /reports/overview
export interface OverviewReport {
  window: ReportWindow;
  totals: ReportTotals;
  measures: ReportDelta[];
  habits: ReportHabitCount[];
  best_habit: ReportHabitCount | null;
  weakest_habit: ReportHabitCount | null;
  promises: ReportPromiseCounts;
  top_people: ReportRank[];
  top_topics: ReportRank[];
  by_relationship: ReportRelationshipGroup[];
  series: ReportDayPoint[];
  highlights: ReportHighlight[];
  insufficient_data: boolean; // too few conversations to compare with the previous window
  graph_focus: GraphFocus;
}

export interface PersonReportSummary {
  person_id: string;
  node_id: string;
  name: string;
  conversations: number;
  minutes_together: number;
  minutes_spoken: number;
  last_talked: number | null;
  relationship: RelationshipKind | null; // null = never analysed (GET /relationships)
  relationship_confidence: number | null;
  relationship_source: RelationshipSource | null;
  comparisons: ReportComparison[];
  sentence: string | null; // the clearest meaningful comparison, ready to show
  open_promises: number;
  top_topics: ReportRank[];
}

// GET /reports/by-person
export interface ByPersonReport {
  window: ReportWindow;
  people: PersonReportSummary[];
  untagged_conversations: number;
  graph_focus: GraphFocus;
}

// GET /reports/person/{person_id}
export interface PersonReport {
  window: ReportWindow;
  person: PersonReportSummary;
  topics: ReportRank[];
  promises: ReportPromise[];
  habits: ReportCount[];
  timeline: ReportConversation[];
  graph_focus: GraphFocus;
}

export interface TopicReportSummary {
  topic_id: string; // slug
  node_id: string;
  label: string;
  conversations: number;
  minutes_together: number;
  last_discussed: number | null;
  trend: ReportDelta; // conversations on the topic, this window vs the previous one
  people: ReportRank[];
  comparisons: ReportComparison[];
  sentence: string | null;
  promises: number;
}

// GET /reports/by-topic
export interface ByTopicReport {
  window: ReportWindow;
  topics: TopicReportSummary[];
  graph_focus: GraphFocus;
}

// GET /reports/topic/{topic_id}
export interface TopicReport {
  window: ReportWindow;
  topic: TopicReportSummary;
  series: ReportBucket[];
  promises: ReportPromise[];
  quotes: ReportQuote[]; // the wearer's own words
  habits: ReportCount[];
  timeline: ReportConversation[];
  graph_focus: GraphFocus;
}

export interface HabitReport {
  habit: ReportHabitCount;
  series: ReportBucket[];
  by_person: ReportCount[];
  by_topic: ReportCount[];
  if_then: string[]; // plans the debriefs suggested when this habit led the conversation
}

// GET /reports/habits
export interface HabitsReport {
  window: ReportWindow;
  habits: HabitReport[];
  graph_focus: GraphFocus;
}

// GET /reports/promises
export interface PromisesReport {
  window: ReportWindow;
  counts: ReportPromiseCounts;
  open: ReportPromise[];
  done: ReportPromise[];
  graph_focus: GraphFocus;
}

// ---------- spoken practice with the coach (WS /ws/practice, GET /practice/*) ----------
// The wearer answers the ACTIVE coach's spoken questions. The backend relays audio to the
// Deepgram Voice Agent (the key never reaches the browser), measures each answer and scores it.
// A measure that could not be taken is null, never zero.
//
// WebSocket /ws/practice (one session per connection; a second concurrent one gets error 'busy'):
//   browser -> backend
//     binary: microphone PCM, linear16 little-endian, 16 000 Hz, mono (send only after practice.ready)
//     PracticeClientMessage (JSON text)
//   backend -> browser
//     binary: coach voice PCM, linear16 little-endian, 24 000 Hz, mono (queue and play in order)
//     PracticeServerMessage (JSON text)
//   Order: connect -> practice.ready -> (state / caption / audio)* -> practice.scoring ->
//          practice.result | practice.no_result -> the backend closes the socket.
//   On practice.state 'you' the browser stops coach playback at once and drops queued audio (barge-in).
//   When the coach's queued audio has finished playing, the browser sends {type:'playback_done'}
//   (used to measure time-to-start honestly). {type:'end'} ends early; the answers so far are scored.

export type PracticeMeasure = 'pace' | 'fillers' | 'conciseness' | 'structure' | 'confidence' | 'responsiveness';
export type PracticeScoreSource = 'measured' | 'judged' | 'rules';
export type PracticeJudge = 'gemini' | 'rules';
export type PracticeSpeaker = 'coach' | 'you' | 'thinking' | 'waiting';
export type PracticeErrorCode = 'no_key' | 'agent_refused' | 'agent_lost' | 'mic_silent' | 'busy' | 'bad_message';

export type PracticeClientMessage = { type: 'playback_done' } | { type: 'end' };

export type PracticeServerMessage =
  | { type: 'practice.ready'; coach_name: string; planned_questions: number; previous_goals: PracticeGoal[] }
  | { type: 'practice.state'; state: PracticeSpeaker }
  // question: 1-based number of the coach's current question (null before the first one)
  | { type: 'practice.caption'; role: 'coach' | 'you'; text: string; question: number | null }
  | { type: 'practice.warning'; code: 'mic_quiet'; message: string }
  | { type: 'practice.scoring' }
  | { type: 'practice.result'; result: PracticeResult }
  | { type: 'practice.no_result'; message: string }
  | { type: 'practice.error'; code: PracticeErrorCode; message: string };

export interface PracticeAnswer {
  index: number; // 1-based, in the order the questions were asked
  question: string;
  text: string;
  words: number;
  speaking_s: number | null; // first word to last word, from word timings
  wpm: number | null;
  fillers: string[]; // each filler as heard, in order
  fillers_per_min: number | null;
  hedges: string[];
  long_pauses: number | null; // gaps of 2 s or more between words
  time_to_start_s: number | null; // coach audio finished (in the browser) -> first word
}

export interface PracticeTotals {
  answers: number;
  words: number;
  speaking_s: number | null;
  wpm: number | null;
  filler_count: number;
  fillers_per_min: number | null;
  top_fillers: string[];
  hedges: number;
  long_pauses: number | null;
  mean_answer_s: number | null;
  mean_time_to_start_s: number | null;
}

export interface PracticeSubScore {
  measure: PracticeMeasure;
  label: string;
  score: number; // 0-100
  source: PracticeScoreSource; // measured from numbers, judged by Gemini, or a rule-based estimate
  detail: string; // plain words, e.g. "148 words a minute"
}

export interface PracticeStrength {
  title: string;
  detail: string;
  from_answer: number | null;
}

export interface PracticeGoal {
  measure: PracticeMeasure;
  title: string; // e.g. "Fewer filler words"
  target: string; // e.g. "Under 3 filler words a minute; you had 7"
  target_min: number | null; // numeric target, when the measure is a number
  target_max: number | null;
  unit: string | null;
  actual: number | null; // this session's value of the measure
  from_answer: number | null;
  evidence: string | null; // a short quote or number from that answer
}

export interface PracticeGoalCheck {
  goal: PracticeGoal; // the goal as set last time
  now: number | null; // this session's value of the same measure
  met: boolean | null; // null: could not be measured this time
  detail: string;
}

// GET /practice/results/{id}; also inside practice.result
export interface PracticeResult {
  id: string;
  coach_id: string;
  coach_name: string;
  started_at: string; // ISO 8601
  duration_s: number;
  overall: number; // 0-100
  summary: string;
  sub_scores: PracticeSubScore[];
  strengths: PracticeStrength[];
  goals: PracticeGoal[];
  previous_goals: PracticeGoalCheck[];
  answers: PracticeAnswer[];
  totals: PracticeTotals;
  judged_by: PracticeJudge;
  ended_early: boolean;
}

// GET /practice/results -> PracticeResultSummary[] (newest first)
export interface PracticeResultSummary {
  id: string;
  coach_name: string;
  started_at: string;
  duration_s: number;
  overall: number;
  answers: number;
  goals_met: number | null; // earlier goals met this time; null when there were none
  goals_checked: number;
}

// GET /practice/goals: the goals from the latest result (empty when there is none yet)
export interface PracticeGoals {
  result_id: string | null;
  started_at: string | null;
  coach_name: string | null;
  overall: number | null;
  goals: PracticeGoal[];
}
