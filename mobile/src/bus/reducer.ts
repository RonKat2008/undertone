/**
 * Pure reducer: folds BusEvents into the one view state both apps render from.
 * Shared verbatim between dashboard/lib/bus and mobile/src/bus.
 */
import type {
  BandTransport, BusEvent, CoachSpec, Debrief, HapticPattern, JudgeAnswer, JudgeSource, Metrics, MotionState,
  NudgePolicy, SessionMode, Speaker,
} from './contracts';
import { VERDICT_TEXT } from './patterns';
import type { SourceStatus } from './types';

export interface TurnView {
  turn_id: string;
  speaker: Speaker;
  text: string;
  start: number;
  end: number;
  wpm: number;
  fillers: string[];
  judge?: { results: Record<string, JudgeAnswer>; latency_ms: number; source: JudgeSource };
}

export type MarkKind = 'nudge' | 'quiet' | 'signal' | 'bookmark' | 'status';

/** Anything worth a tick on the timeline or a line in the log. */
export interface Mark {
  id: string;
  kind: MarkKind;
  ts: number; // session seconds
  at: number; // wall ms
  pattern: HapticPattern | null;
  rule_id: string | null;
  title: string;
  detail: string;
  confidence: number | null;
  latency_ms: number | null;
}

export interface SessionView {
  id: string;
  coach_id: string;
  mode: SessionMode;
  policy: NudgePolicy;
  startedAt: number; // wall ms
  endedAt: number | null;
}

export interface PracticeView {
  round: number; // 0 = no practice round yet
  count: number; // crutch words caught this round
  previous: number | null; // last round's count
  words: Record<string, number>;
  success: boolean;
}

export interface BusState {
  status: SourceStatus;
  band: { connected: boolean; transport: BandTransport; battery_pct: number | null; mic_on: boolean } | null;
  devices: Record<string, { device_id: string; name: string; connected: boolean }>;
  coach: CoachSpec | null;
  session: SessionView | null;
  turns: TurnView[];
  partial: { speaker: Speaker | null; text: string } | null;
  metrics: Metrics | null;
  history: { wpm: number[]; energy: number[]; volume: number[] };
  motion: { state: MotionState; hand_energy: number; speaker_context: Speaker | null; confidence: number; ts: number } | null;
  marks: Mark[];
  lastNudge: Mark | null;
  lastStatus: Mark | null;
  budgetLeft: number | null;
  practice: PracticeView;
  debrief: { session_id: string; data: Debrief; audio_url: string | null; at: number } | null;
  appRequests: { app_id: string; name: string }[];
  calibration: Partial<Record<'speaker' | 'motion' | 'baseline', { step: string; done: boolean }>>;
  seq: number;
}

export const initialState: BusState = {
  status: 'connecting',
  band: null,
  devices: {},
  coach: null,
  session: null,
  turns: [],
  partial: null,
  metrics: null,
  history: { wpm: [], energy: [], volume: [] },
  motion: null,
  marks: [],
  lastNudge: null,
  lastStatus: null,
  budgetLeft: null,
  practice: { round: 0, count: 0, previous: null, words: {}, success: false },
  debrief: null,
  appRequests: [],
  calibration: {},
  seq: 0,
};

export type BusAction =
  | { type: 'event'; event: BusEvent; at: number }
  | { type: 'status'; status: SourceStatus }
  | { type: 'reset' }
  | { type: 'app.resolved'; app_id: string };

const HISTORY = 90;
const MAX_TURNS = 200;
const MAX_MARKS = 300;

const push = <T,>(list: T[], item: T, max: number): T[] => (list.length >= max ? [...list.slice(list.length - max + 1), item] : [...list, item]);

const SIGNAL_TITLE = { nerves: 'Nerves', checked_out: 'Checked out' } as const;

/** The crutch word inside a reason like: You said “basically”. */
export function wordFromReason(reason: string): string | null {
  const m = reason.match(/[“"']([^”"']+)[”"']/);
  return m ? m[1].toLowerCase() : null;
}

function mark(state: BusState, at: number, m: Omit<Mark, 'id' | 'at'>): Mark {
  return { ...m, id: `m${state.seq + 1}`, at };
}

export function reduce(state: BusState, action: BusAction): BusState {
  switch (action.type) {
    case 'status':
      return state.status === action.status ? state : { ...state, status: action.status };
    case 'reset':
      return { ...initialState, status: state.status };
    case 'app.resolved':
      return { ...state, appRequests: state.appRequests.filter((a) => a.app_id !== action.app_id) };
    case 'event':
      return { ...fold(state, action.event, action.at), seq: state.seq + 1 };
  }
}

function fold(state: BusState, e: BusEvent, at: number): BusState {
  switch (e.type) {
    case 'band.status':
      return { ...state, band: { connected: e.connected, transport: e.transport, battery_pct: e.battery_pct, mic_on: e.mic_on } };
    case 'device.status':
      return { ...state, devices: { ...state.devices, [e.device_id]: { device_id: e.device_id, name: e.name, connected: e.connected } } };
    case 'coach.activated':
      return { ...state, coach: e.coach };
    case 'session.started': {
      const wasPractice = state.session?.mode === 'practice';
      const practice: PracticeView = e.mode === 'practice'
        ? { round: state.practice.round + 1, count: 0, previous: wasPractice || state.practice.round > 0 ? state.practice.count : null, words: {}, success: false }
        : state.practice;
      return {
        ...state,
        session: { id: e.session_id, coach_id: e.coach_id, mode: e.mode, policy: e.policy, startedAt: at, endedAt: null },
        turns: [], partial: null, metrics: null, history: { wpm: [], energy: [], volume: [] }, motion: null,
        marks: [], lastNudge: null, lastStatus: null, budgetLeft: e.policy.budget_per_session, practice,
      };
    }
    case 'session.ended':
      return state.session ? { ...state, session: { ...state.session, endedAt: at }, partial: null } : state;
    case 'calibration':
      return { ...state, calibration: { ...state.calibration, [e.kind]: { step: e.step, done: e.done } } };
    case 'transcript.partial':
      return { ...state, partial: e.text ? { speaker: e.speaker, text: e.text } : null };
    case 'turn.final': {
      const turn: TurnView = { turn_id: e.turn_id, speaker: e.speaker, text: e.text, start: e.start, end: e.end, wpm: e.wpm, fillers: e.fillers };
      const clear = !state.partial || state.partial.speaker === e.speaker || state.partial.speaker === null;
      return { ...state, turns: push(state.turns, turn, MAX_TURNS), partial: clear ? null : state.partial };
    }
    case 'judge':
      return { ...state, turns: state.turns.map((t) => (t.turn_id === e.turn_id ? { ...t, judge: { results: e.results, latency_ms: e.latency_ms, source: e.source } } : t)) };
    case 'metrics': {
      const { type: _type, ...metrics } = e;
      void _type;
      return {
        ...state, metrics,
        history: {
          wpm: push(state.history.wpm, metrics.wpm, HISTORY),
          energy: push(state.history.energy, metrics.hand_energy, HISTORY),
          volume: push(state.history.volume, metrics.volume_db, HISTORY),
        },
      };
    }
    case 'motion':
      return { ...state, motion: { state: e.state, hand_energy: e.hand_energy, speaker_context: e.speaker_context, confidence: e.confidence, ts: e.ts } };
    case 'signal': {
      const m = mark(state, at, { kind: 'signal', ts: e.ts, pattern: null, rule_id: e.kind, title: SIGNAL_TITLE[e.kind], detail: e.detail, confidence: null, latency_ms: null });
      return { ...state, marks: push(state.marks, m, MAX_MARKS) };
    }
    case 'nudge': {
      const m = mark(state, at, { kind: 'nudge', ts: e.ts, pattern: e.haptic, rule_id: e.rule_id, title: e.message, detail: e.reason, confidence: e.confidence, latency_ms: e.latency_ms });
      let practice = state.practice;
      if (state.session?.mode === 'practice') {
        if (e.haptic === 'filler') {
          const word = wordFromReason(e.reason) ?? 'crutch word';
          practice = { ...practice, count: practice.count + 1, words: { ...practice.words, [word]: (practice.words[word] ?? 0) + 1 } };
        } else if (e.haptic === 'success') {
          practice = { ...practice, success: true };
        }
      }
      return { ...state, marks: push(state.marks, m, MAX_MARKS), lastNudge: m, budgetLeft: e.budget_left, practice };
    }
    case 'nudge.quiet': {
      const m = mark(state, at, { kind: 'quiet', ts: e.ts, pattern: e.haptic, rule_id: e.rule_id, title: e.message, detail: e.reason, confidence: null, latency_ms: null });
      return { ...state, marks: push(state.marks, m, MAX_MARKS) };
    }
    case 'nudge.snoozed':
      return state;
    case 'status.reply': {
      const m = mark(state, at, { kind: 'status', ts: e.ts, pattern: e.haptic, rule_id: null, title: VERDICT_TEXT[e.verdict], detail: 'Answer to a single tap: “How am I doing?”', confidence: null, latency_ms: null });
      return { ...state, marks: push(state.marks, m, MAX_MARKS), lastStatus: m };
    }
    case 'bookmark': {
      const m = mark(state, at, { kind: 'bookmark', ts: e.ts, pattern: null, rule_id: e.source, title: e.source === 'promise' ? 'Promise' : 'Bookmark', detail: e.text ?? 'Marked on the phone', confidence: null, latency_ms: null });
      return { ...state, marks: push(state.marks, m, MAX_MARKS) };
    }
    case 'debrief':
      return { ...state, debrief: { session_id: e.session_id, data: e.data, audio_url: e.audio_url, at } };
    case 'app.request':
      return state.appRequests.some((a) => a.app_id === e.app_id) ? state : { ...state, appRequests: [...state.appRequests, { app_id: e.app_id, name: e.name }] };
  }
}

/** True while a session is running. */
export function isLive(state: BusState): boolean {
  return state.session !== null && state.session.endedAt === null;
}
