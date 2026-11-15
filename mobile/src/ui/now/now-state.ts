/**
 * Which one state the Now tab shows (mobile/DESIGN.md, "Now: the state table"). Pure: no I/O, no clocks.
 * Order is priority; the first that applies wins.
 */
import type { HapticPattern } from '@/bus/contracts';
import { listenState, type PhoneState } from '@/bus/phone-state';
import { isLive } from '@/bus/reducer';
import type { Buzz } from '@/bus/use-bus';
import { patternWord } from '../Pattern';
import { DUR } from '../theme';

/** After this long with no debrief, a conversation that closed quietly is not getting one. */
export const DEBRIEF_WAIT_MS = 120000;
/** Practice: only `success` takes the field, briefly. */
const SUCCESS_MS = 1500;
const PRACTICE_RESULT_MS = 60000;
/** Without a known usual pace, this is the reference. */
const DEFAULT_BASELINE_WPM = 160;
const DEFAULT_TOLERANCE = 0.25;

export interface Takeover { key: string; word: string; line: string | null; at: number; hold: number }

export type NowKind =
  | 'not-paired' | 'connecting' | 'offline'
  | 'status' | 'conversation' | 'practice'
  | 'debrief-ready' | 'writing'
  | 'band-off' | 'mic-off' | 'listening' | 'ready';

export interface NowView {
  kind: NowKind;
  /** The nudge field over everything, while it holds. */
  takeover: Takeover | null;
  /** Pace, while in a regular conversation. */
  rushing: boolean;
  wpm: number;
  elapsedS: number;
  statusWord: string | null;
}

function takeoverOf(state: PhoneState, buzzes: Buzz[], now: number): Takeover | null {
  const session = state.session;
  if (!session || session.endedAt !== null) return null;
  const practice = session.mode === 'practice';
  const n = state.lastNudge;
  let pick: Takeover | null = null;
  if (n?.pattern && (!practice || n.pattern === 'success')) {
    pick = { key: n.id, word: patternWord(n.pattern as HapticPattern), line: null, at: n.at, hold: practice ? SUCCESS_MS : DUR.nudge };
  }
  const foreign = buzzes[0] && buzzes[0].source_app !== 'undertone' ? buzzes[0] : null;
  if (foreign && (!pick || foreign.at > pick.at)) {
    pick = { key: `f${foreign.id}`, word: foreign.label || patternWord(foreign.pattern), line: `From ${foreign.source_app}`, at: foreign.at, hold: DUR.nudge };
  }
  return pick && now - pick.at < pick.hold ? pick : null;
}

export function nowView(state: PhoneState, mode: 'loading' | 'unpaired' | 'live', buzzes: Buzz[], now: number): NowView {
  const session = state.session;
  const live = isLive(state);
  const wpm = Math.round(state.metrics?.wpm ?? 0);
  const baseline = state.metrics?.baseline_wpm ?? DEFAULT_BASELINE_WPM;
  const tolerance = session?.policy?.tolerance ?? DEFAULT_TOLERANCE;
  const elapsedS = session ? ((session.endedAt ?? now) - session.startedAt) / 1000 : 0;
  const status = state.lastStatus && now - state.lastStatus.at < DUR.status ? state.lastStatus : null;
  const base = { takeover: null, rushing: false, wpm, elapsedS, statusWord: null };

  if (mode !== 'live') return { ...base, kind: 'not-paired' };
  if (state.status === 'offline') return { ...base, kind: 'offline' };
  if (state.status === 'connecting' && !live) return { ...base, kind: 'connecting' };

  const takeover = takeoverOf(state, buzzes, now);
  if (live && status?.pattern) return { ...base, takeover, kind: 'status', statusWord: patternWord(status.pattern) };
  if (live && session?.mode === 'practice') return { ...base, takeover, kind: 'practice' };
  if (live) return { ...base, takeover, kind: 'conversation', rushing: wpm > 0 && wpm > baseline * (1 + tolerance) };

  if (state.notice) return { ...base, kind: 'debrief-ready' };
  const ended = session?.endedAt ?? null;
  // A practice round that just finished keeps its score up for a minute, with "Another round".
  if (session?.mode === 'practice' && ended !== null && now - ended < PRACTICE_RESULT_MS) return { ...base, kind: 'practice' };
  const debriefIn = !!session && state.debrief?.session_id === session.id;
  if (session && ended !== null && !debriefIn && now - ended < DEBRIEF_WAIT_MS && session.mode !== 'practice') return { ...base, kind: 'writing' };

  if (state.alwaysOn) {
    const listen = listenState(state);
    if (listen === 'no-band') return { ...base, kind: 'band-off' };
    if (listen === 'mic-off') return { ...base, kind: 'mic-off' };
    return { ...base, kind: 'listening' };
  }
  // Tap to start: the mic only opens once a conversation starts, so "mic off" is normal here.
  // Only a band that said it is disconnected is worth a state.
  if (state.band && !state.band.connected) return { ...base, kind: 'band-off' };
  return { ...base, kind: 'ready' };
}
