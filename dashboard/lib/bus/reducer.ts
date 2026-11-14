/* eslint-disable @typescript-eslint/no-unused-vars */
import { BusEvent, MotionState, BandTransport, SessionMode, NudgePolicy, Metrics, JudgeAnswer, Debrief, CoachSpec } from './contracts';

export interface BusState {
  bandStatus: { connected: boolean; transport: BandTransport | null; battery_pct: number | null; mic_on: boolean };
  deviceStatus: { device_id: string; name: string; connected: boolean } | null;
  activeCoach: CoachSpec | null;
  sessionStatus: 'idle' | 'active' | 'ended';
  sessionId: string | null;
  mode: SessionMode | null;
  policy: NudgePolicy | null;
  elapsedS: number;
  turns: Array<{ turn_id: string; speaker: string; text: string; start: number; end: number; wpm: number; fillers: string[] }>;
  partialTranscript: { speaker: string | null; text: string } | null;
  judgeByTurnId: Record<string, Record<string, JudgeAnswer>>;
  metrics: Metrics | null;
  metricsHistory: Metrics[];
  motion: { state: MotionState; hand_energy: number; speaker_context: string | null; confidence: number; ts: number } | null;
  motionHistory: Array<{ state: MotionState; hand_energy: number; ts: number }>;
  signals: Array<{ kind: 'nerves' | 'checked_out'; detail: string; ts: number }>;
  nudges: Array<{ rule_id: string; haptic: string; message: string; reason: string; ts: number }>;
  quietNudges: Array<{ rule_id: string; haptic: string; message: string; reason: string; ts: number }>;
  activeNudge: { rule_id: string; haptic: string; message: string; reason: string; ts: number; budget_left: number } | null;
  activeStatusReply: { verdict: string; haptic: string; ts: number } | null;
  bookmarks: Array<{ source: string; text: string | null; ts: number }>;
  debrief: { data: Debrief; audio_url: string | null } | null;
  pendingAppRequests: Array<{ app_id: string; name: string }>;
}

export type Action = 
  | { type: 'EVENT'; event: BusEvent }
  | { type: 'INTERNAL_RESET' }
  | { type: 'INTERNAL_JUMP_TO_DEBRIEF' }
  | { type: 'CLEAR_ACTIVE_NUDGE' }
  | { type: 'CLEAR_ACTIVE_STATUS_REPLY' };

const initialState: BusState = {
  bandStatus: { connected: false, transport: null, battery_pct: null, mic_on: false },
  deviceStatus: null,
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
  motionHistory: [],
  signals: [],
  nudges: [],
  quietNudges: [],
  activeNudge: null,
  activeStatusReply: null,
  bookmarks: [],
  debrief: null,
  pendingAppRequests: []
};

export function busReducer(state: BusState, action: Action): BusState {
  if (action.type === 'INTERNAL_RESET') {
    return initialState;
  }
  if (action.type === 'INTERNAL_JUMP_TO_DEBRIEF') {
    return { ...state, sessionStatus: 'ended' };
  }
  if (action.type === 'CLEAR_ACTIVE_NUDGE') {
    return { ...state, activeNudge: null };
  }
  if (action.type === 'CLEAR_ACTIVE_STATUS_REPLY') {
    return { ...state, activeStatusReply: null };
  }
  if (action.type === 'EVENT') {
    const e = action.event;
    switch (e.type) {
      case 'band.status':
        return { ...state, bandStatus: { connected: e.connected, transport: e.transport, battery_pct: e.battery_pct, mic_on: e.mic_on } };
      case 'device.status':
        return { ...state, deviceStatus: { device_id: e.device_id, name: e.name, connected: e.connected } };
      case 'coach.activated':
        return { ...state, activeCoach: e.coach };
      case 'session.started':
        return { ...state, sessionStatus: 'active', sessionId: e.session_id, mode: e.mode, policy: e.policy, elapsedS: e.ts, turns: [], partialTranscript: null, judgeByTurnId: {}, metrics: null, metricsHistory: [], motion: null, motionHistory: [], signals: [], nudges: [], quietNudges: [], activeNudge: null, activeStatusReply: null, bookmarks: [], debrief: null };
      case 'transcript.partial':
        return { ...state, partialTranscript: { speaker: e.speaker, text: e.text } };
      case 'turn.final':
        return { ...state, turns: [...state.turns, { turn_id: e.turn_id, speaker: e.speaker, text: e.text, start: e.start, end: e.end, wpm: e.wpm, fillers: e.fillers }], partialTranscript: null };
      case 'judge':
        return { ...state, judgeByTurnId: { ...state.judgeByTurnId, [e.turn_id]: { ...state.judgeByTurnId[e.turn_id], ...e.results } } };
      case 'metrics':
        const { type: _type, ...mets } = e;
        return { ...state, metrics: mets as Metrics, metricsHistory: [...state.metricsHistory, mets as Metrics] };
      case 'motion':
        const mot = { state: e.state, hand_energy: e.hand_energy, ts: e.ts };
        return { ...state, motion: { state: e.state, hand_energy: e.hand_energy, speaker_context: e.speaker_context, confidence: e.confidence, ts: e.ts }, motionHistory: [...state.motionHistory, mot] };
      case 'signal':
        return { ...state, signals: [...state.signals, { kind: e.kind, detail: e.detail, ts: e.ts }] };
      case 'nudge':
        const n = { rule_id: e.rule_id, haptic: e.haptic, message: e.message, reason: e.reason, ts: e.ts, budget_left: e.budget_left };
        return { ...state, nudges: [...state.nudges, n], activeNudge: n };
      case 'nudge.quiet':
        return { ...state, quietNudges: [...state.quietNudges, { rule_id: e.rule_id, haptic: e.haptic, message: e.message, reason: e.reason, ts: e.ts }] };
      case 'status.reply':
        return { ...state, activeStatusReply: { verdict: e.verdict, haptic: e.haptic, ts: e.ts } };
      case 'bookmark':
        return { ...state, bookmarks: [...state.bookmarks, { source: e.source, text: e.text, ts: e.ts }] };
      case 'session.ended':
        return { ...state, sessionStatus: 'ended' };
      case 'debrief':
        return { ...state, debrief: { data: e.data, audio_url: e.audio_url } };
      case 'app.request':
        return { ...state, pendingAppRequests: [...state.pendingAppRequests, { app_id: e.app_id, name: e.name }] };
      default:
        return state;
    }
  }
  return state;
}
