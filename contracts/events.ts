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
  sample: boolean; // true only for the built-in illustrative graph shown before any session exists
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
