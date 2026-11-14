/**
 * Phone-only view state, layered on the shared reducer (which stays verbatim with the dashboard).
 *
 *   alwaysOn   the band listens all day; conversations open and close by themselves.
 *              Read from `band.status.always_on` (optional; absent means false).
 *   resync     bumps every time the bus socket comes (back) up: screens refetch their lists.
 *   lastEnded  the conversation that closed most recently: screens refetch on it.
 *   notice     a debrief just arrived: the gentle in-app notice that opens it.
 *
 * Pure: no I/O, no clocks. `at` comes in on the action.
 */
import type { BusEvent } from './contracts';
import { initialState as busInitial, reduce, type BusAction, type BusState } from './reducer';

export interface DebriefNotice {
  session_id: string;
  headline: string;
  at: number;
}

export interface PhoneState extends BusState {
  alwaysOn: boolean;
  resync: number;
  lastEnded: { session_id: string; at: number } | null;
  notice: DebriefNotice | null;
}

export type PhoneAction =
  | BusAction
  | { type: 'notice.dismiss' }
  /** A new source (pairing changed): forget everything, including phone-only state. */
  | { type: 'source.changed' };

export const initialPhoneState: PhoneState = {
  ...busInitial,
  alwaysOn: false,
  resync: 0,
  lastEnded: null,
  notice: null,
};

/**
 * `always_on` rides on GET /band/status (the backend adds it there only); it is optional on the
 * `band.status` bus event too. Returns null when the field is absent: the backend's band.status
 * heartbeat does not carry it, so absence must not switch always-on off. Until any reply says
 * true, the phone treats always-on as false (today's behaviour).
 */
export function readAlwaysOn(event: BusEvent): boolean | null {
  if (event.type !== 'band.status') return null;
  const value = (event as { always_on?: unknown }).always_on;
  return typeof value === 'boolean' ? value : null;
}

export function reducePhone(state: PhoneState, action: PhoneAction): PhoneState {
  if (action.type === 'source.changed') return { ...initialPhoneState, status: state.status, resync: state.resync };
  if (action.type === 'notice.dismiss') return state.notice ? { ...state, notice: null } : state;

  const bus = reduce(state, action); // 'reset' returns a bare BusState: extras are re-applied below
  const extras = foldExtras(state, action);
  return { ...bus, ...extras };
}

function foldExtras(state: PhoneState, action: BusAction): Pick<PhoneState, 'alwaysOn' | 'resync' | 'lastEnded' | 'notice'> {
  const { alwaysOn, resync, lastEnded, notice } = state;
  const same = { alwaysOn, resync, lastEnded, notice };
  if (action.type === 'status') {
    // Coming (back) up from anything else: the phone may have missed events. Refetch.
    return action.status === 'live' && state.status !== 'live' ? { ...same, resync: resync + 1 } : same;
  }
  if (action.type !== 'event') return same;
  const e = action.event;
  switch (e.type) {
    case 'band.status':
      return { ...same, alwaysOn: readAlwaysOn(e) ?? alwaysOn };
    case 'session.ended':
      return { ...same, lastEnded: { session_id: e.session_id, at: action.at } };
    case 'debrief': {
      const headline = (e.data as { headline_fact?: unknown } | null)?.headline_fact;
      return { ...same, notice: { session_id: e.session_id, headline: typeof headline === 'string' ? headline : '', at: action.at } };
    }
    default:
      return same;
  }
}

/** What the live screen says about the band and the laptop, in always-on mode. */
export type ListenState = 'connecting' | 'offline' | 'no-band' | 'mic-off' | 'listening' | 'in-conversation';

export function listenState(state: BusState): ListenState {
  if (state.status === 'offline') return 'offline';
  if (state.status === 'connecting') return 'connecting';
  if (state.session && state.session.endedAt === null) return 'in-conversation';
  if (!state.band || !state.band.connected) return 'no-band';
  if (!state.band.mic_on) return 'mic-off';
  return 'listening';
}
