import { BusEvent, CoachSpec, NudgePolicy, Metrics, MotionState, JudgeAnswer, Debrief, BookmarkReview } from './contracts';

export interface Turn {
  id: string;
  speaker: 'me' | 'other';
  text: string;
}

export interface NudgeRecord {
  id: string;
  rule_id: string;
  message: string;
  ts: number;
}

export interface SignalRecord {
  kind: 'nerves' | 'checked_out';
  detail: string;
  ts: number;
}

export interface BusState {
  bandConnected: boolean;
  deviceConnected: boolean;
  activeCoach: CoachSpec | null;
  sessionStatus: 'idle' | 'active' | 'ended';
  sessionId: string | null;
  mode: string | null;
  policy: NudgePolicy | null;
  elapsedS: number;
  turns: Turn[];
  partialTranscript: { speaker: 'me' | 'other' | null; text: string } | null;
  judgeByTurnId: Record<string, Record<string, JudgeAnswer>>;
  metrics: Metrics | null;
  metricsHistory: Metrics[];
  motion: { state: MotionState; energy: number } | null;
  signals: SignalRecord[];
  nudges: NudgeRecord[];
  quietNudges: NudgeRecord[];
  activeNudge: NudgeRecord | null;
  activeStatusReply: { verdict: string; ts: number } | null;
  bookmarks: BookmarkReview[];
  debrief: Debrief | null;
  pendingAppRequests: { id: string; name: string }[];
}

export const initialBusState: BusState = {
  bandConnected: false,
  deviceConnected: false,
  activeCoach: null,
  sessionStatus: 'idle',
  sessionId: null,
  mode: null,
  policy: null,
  elapsedS: 0,
  turns: [],
  partialTranscript: null,
  judgeByTurnId: {},
  metrics: null,
  metricsHistory: [],
  motion: null,
  signals: [],
  nudges: [],
  quietNudges: [],
  activeNudge: null,
  activeStatusReply: null,
  bookmarks: [],
  debrief: null,
  pendingAppRequests: []
};

export type BusAction =
  | { type: 'event'; event: BusEvent }
  | { type: 'reset' }
  | { type: 'jump_to_debrief' }
  | { type: 'tick' };

export function busReducer(state: BusState, action: BusAction): BusState {
  if (action.type === 'reset') return initialBusState;
  if (action.type === 'jump_to_debrief') return { ...state, sessionStatus: 'ended' };
  if (action.type === 'tick') return { ...state, elapsedS: state.elapsedS + 1 };

  if (action.type === 'event') {
    const e = action.event;
    switch (e.type) {
      case 'band.status': return { ...state, bandConnected: e.connected };
      case 'device.status': return { ...state, deviceConnected: e.connected };
      case 'coach.activated': return { ...state, activeCoach: e.coach };
      case 'session.started': return {
        ...state,
        sessionStatus: 'active',
        sessionId: e.session_id,
        mode: e.mode,
        policy: e.policy,
        elapsedS: 0,
        turns: [],
        metricsHistory: [],
        nudges: [],
        quietNudges: [],
        signals: [],
        bookmarks: [],
        debrief: null
      };
      case 'session.ended': return { ...state, sessionStatus: 'ended' };
      case 'transcript.partial': return { ...state, partialTranscript: { speaker: e.speaker, text: e.text } };
      case 'turn.final': return {
        ...state,
        partialTranscript: null,
        turns: [...state.turns, { id: e.turn_id, speaker: e.speaker, text: e.text }]
      };
      case 'judge': return {
        ...state,
        judgeByTurnId: { ...state.judgeByTurnId, [e.turn_id]: e.results }
      };
      case 'metrics': {
        const { type, ...m } = e;
        return {
          ...state,
          metrics: m as Metrics,
          metricsHistory: [...state.metricsHistory, m as Metrics]
        };
      }
      case 'motion': return { ...state, motion: { state: e.state, energy: e.hand_energy } };
      case 'nudge': {
        const n = { id: Math.random().toString(), rule_id: e.rule_id, message: e.message, ts: e.ts };
        return { ...state, nudges: [...state.nudges, n], activeNudge: n };
      }
      case 'nudge.quiet': {
        const n = { id: Math.random().toString(), rule_id: e.rule_id, message: e.message, ts: e.ts };
        return { ...state, quietNudges: [...state.quietNudges, n] };
      }
      case 'status.reply': return { ...state, activeStatusReply: { verdict: e.verdict, ts: e.ts } };
      case 'signal': return { ...state, signals: [...state.signals, { kind: e.kind, detail: e.detail, ts: e.ts }] };
      case 'bookmark': return {
        ...state,
        bookmarks: [...state.bookmarks, { ts: e.ts, source: e.source, snippet: e.text || '', what_happened: '', follow_up: null }]
      };
      case 'debrief': return { ...state, debrief: e.data };
      case 'app.request': return { ...state, pendingAppRequests: [...state.pendingAppRequests, { id: e.app_id, name: e.name }] };
      default: return state;
    }
  }
  return state;
}
