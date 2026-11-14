/** `useBus()` for the phone: mock feed, or the live sockets once paired. Same hook, same state. */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { addMockSession, clearMockSessions, setApi } from '@/api/client';
import { play } from '@/haptics/player';
import type { BusEvent, HapticCommand } from './contracts';
import { createAlwaysOnMockSource } from './mock-always-on';
import { createMockSource } from './mock-source';
import { initialPhoneState, reducePhone, summaryFromDebrief, type PhoneState } from './phone-state';
import { clearPairing, createSocketSource, loadPairing, savePairing, type Pairing, type StoredPairing } from './socket-source';
import type { BusSource, DirectorCommand } from './types';

export interface Buzz extends HapticCommand {
  at: number;
  id: number;
}

export interface BusApi {
  state: PhoneState;
  /** loading: reading storage. unpaired: show the Pair screen. mock / live: running. */
  mode: 'loading' | 'unpaired' | 'mock' | 'live';
  pairing: Pairing | null;
  /** Buzzes received from the backend (ours and third-party apps'), newest first. */
  buzzes: Buzz[];
  /** Demo only: play the always-on day (conversations open and close by themselves). */
  alwaysOnDemo: boolean;
  setAlwaysOnDemo(on: boolean): void;
  send(command: DirectorCommand): void;
  pair(pairing: Pairing | 'demo'): Promise<void>;
  unpair(): Promise<void>;
  resolveApp(app_id: string): void;
  dismissNotice(): void;
}

const BusContext = createContext<BusApi | null>(null);
const ENV_URL = process.env.EXPO_PUBLIC_BUS_URL?.replace(/\/+$/, '') || null;

function webQuery(): URLSearchParams | null {
  const search = (globalThis as { location?: { search?: string } }).location?.search;
  return search ? new URLSearchParams(search) : null;
}

export function BusProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducePhone, initialPhoneState);
  const [stored, setStored] = useState<StoredPairing | undefined>(undefined);
  const [buzzes, setBuzzes] = useState<Buzz[]>([]);
  const [alwaysOnDemo, setAlwaysOnDemo] = useState(() => webQuery()?.get('always') === '1');
  const sourceRef = useRef<BusSource | null>(null);
  const buzzId = useRef(0);

  useEffect(() => {
    const q = webQuery();
    if (q?.get('demo') === '1') { setStored('demo'); return; }
    loadPairing().then(setStored);
  }, []);

  const pairing = stored && stored !== 'demo' ? stored : null;
  const live: Pairing | null = pairing ?? (ENV_URL && stored !== 'demo' ? { server_url: ENV_URL, device_id: '', device_token: '' } : null);
  const mode: BusApi['mode'] = stored === undefined ? 'loading' : live ? 'live' : stored === 'demo' ? 'mock' : 'unpaired';
  const liveKey = live ? `${live.server_url}|${live.device_id}` : '';
  const sourceKey = `${liveKey}|${!live && alwaysOnDemo ? 'always' : 'script'}`;

  useEffect(() => {
    if (mode !== 'mock' && mode !== 'live') return;
    setApi(live ? { url: live.server_url, token: live.device_token } : null);
    clearMockSessions();
    const q = webQuery();
    const num = (k: string) => (q?.get(k) != null && !Number.isNaN(Number(q.get(k))) ? Number(q.get(k)) : undefined);
    const source = live
      ? createSocketSource(live)
      : alwaysOnDemo
        ? createAlwaysOnMockSource({ startAt: num('t'), speed: num('speed') })
        : createMockSource({ startAt: num('t'), freeze: q?.get('freeze') === '1', speed: num('speed') });
    sourceRef.current = source;
    dispatch({ type: 'source.changed' });
    let demoStart: { id: string; at: number; coach: string } | null = null;
    let demoEnd: number | null = null;
    source.start({
      onEvent: (event: BusEvent, at?: number) => {
        const when = at ?? Date.now();
        dispatch({ type: 'event', event, at: when });
        // In the mock there is no device socket, so the events themselves buzz (not when replaying history).
        if (source.kind === 'mock' && at === undefined && (event.type === 'nudge' || event.type === 'status.reply')) play(event.haptic);
        if (source.kind === 'mock' && alwaysOnDemo) {
          // the always-on demo's finished conversations land in History, like a real day would
          if (event.type === 'session.started') { demoStart = { id: event.session_id, at: when, coach: 'Interview' }; demoEnd = null; }
          if (event.type === 'session.ended') demoEnd = when;
          if (event.type === 'debrief' && demoStart?.id === event.session_id) {
            addMockSession(summaryFromDebrief(event.session_id, event.data, demoStart.at, demoEnd ?? when, demoStart.coach));
          }
        }
      },
      onStatus: (status) => dispatch({ type: 'status', status }),
      onReset: () => dispatch({ type: 'reset' }),
      onHaptic: (cmd) => {
        play(cmd.pattern, cmd.intensity);
        setBuzzes((list) => [{ ...cmd, at: Date.now(), id: ++buzzId.current }, ...list].slice(0, 30));
      },
    });
    return () => { source.stop(); sourceRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, sourceKey]);

  const pair = useCallback(async (p: Pairing | 'demo') => { await savePairing(p); setStored(p); }, []);
  const unpair = useCallback(async () => { await clearPairing(); setBuzzes([]); setStored(null); }, []);

  const api = useMemo<BusApi>(() => ({
    state, mode, pairing, buzzes, alwaysOnDemo, setAlwaysOnDemo,
    send: (command) => sourceRef.current?.send(command),
    pair, unpair,
    resolveApp: (app_id) => dispatch({ type: 'app.resolved', app_id }),
    dismissNotice: () => dispatch({ type: 'notice.dismiss' }),
  }), [state, mode, pairing, buzzes, alwaysOnDemo, pair, unpair]);

  return <BusContext.Provider value={api}>{children}</BusContext.Provider>;
}

export function useBus(): BusApi {
  const api = useContext(BusContext);
  if (!api) throw new Error('useBus() must be used inside <BusProvider>');
  return api;
}

export function useNow(intervalMs = 500): number {
  const [now, tick] = useReducer(() => Date.now(), Date.now());
  useEffect(() => {
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

/** Bumps whenever the conversation list may have changed: a session ended, a debrief arrived, or the
 *  phone reconnected. Screens put it in their fetch effect's deps. Event-driven; no polling. */
export function useListVersion(): string {
  const { state, mode } = useBus();
  return `${mode}|${state.resync}|${state.lastEnded?.at ?? 0}|${state.debrief?.at ?? 0}`;
}
