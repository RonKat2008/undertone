/** `useBus()` for the phone: mock feed, or the live sockets once paired. Same hook, same state. */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { setApi } from '@/api/client';
import { play } from '@/haptics/player';
import type { BusEvent, HapticCommand } from './contracts';
import { createMockSource } from './mock-source';
import { initialState, reduce, type BusState } from './reducer';
import { clearPairing, createSocketSource, loadPairing, savePairing, type Pairing, type StoredPairing } from './socket-source';
import type { BusSource, DirectorCommand } from './types';

export interface Buzz extends HapticCommand {
  at: number;
  id: number;
}

export interface BusApi {
  state: BusState;
  /** loading: reading storage. unpaired: show the Pair screen. mock / live: running. */
  mode: 'loading' | 'unpaired' | 'mock' | 'live';
  pairing: Pairing | null;
  /** Buzzes received from the backend (ours and third-party apps'), newest first. */
  buzzes: Buzz[];
  send(command: DirectorCommand): void;
  pair(pairing: Pairing | 'demo'): Promise<void>;
  unpair(): Promise<void>;
  resolveApp(app_id: string): void;
}

const BusContext = createContext<BusApi | null>(null);
const ENV_URL = process.env.EXPO_PUBLIC_BUS_URL?.replace(/\/+$/, '') || null;

function webQuery(): URLSearchParams | null {
  const search = (globalThis as { location?: { search?: string } }).location?.search;
  return search ? new URLSearchParams(search) : null;
}

export function BusProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const [stored, setStored] = useState<StoredPairing | undefined>(undefined);
  const [buzzes, setBuzzes] = useState<Buzz[]>([]);
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

  useEffect(() => {
    if (mode !== 'mock' && mode !== 'live') return;
    setApi(live ? { url: live.server_url, token: live.device_token } : null);
    const q = webQuery();
    const num = (k: string) => (q?.get(k) != null && !Number.isNaN(Number(q.get(k))) ? Number(q.get(k)) : undefined);
    const source = live ? createSocketSource(live) : createMockSource({ startAt: num('t'), freeze: q?.get('freeze') === '1', speed: num('speed') });
    sourceRef.current = source;
    dispatch({ type: 'reset' });
    source.start({
      onEvent: (event: BusEvent, at?: number) => {
        dispatch({ type: 'event', event, at: at ?? Date.now() });
        // In the mock there is no device socket, so the events themselves buzz (not when replaying history).
        if (source.kind === 'mock' && at === undefined && (event.type === 'nudge' || event.type === 'status.reply')) play(event.haptic);
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
  }, [mode, liveKey]);

  const pair = useCallback(async (p: Pairing | 'demo') => { await savePairing(p); setStored(p); }, []);
  const unpair = useCallback(async () => { await clearPairing(); setBuzzes([]); setStored(null); }, []);

  const api = useMemo<BusApi>(() => ({
    state, mode, pairing, buzzes,
    send: (command) => sourceRef.current?.send(command),
    pair, unpair,
    resolveApp: (app_id) => dispatch({ type: 'app.resolved', app_id }),
  }), [state, mode, pairing, buzzes, pair, unpair]);

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
