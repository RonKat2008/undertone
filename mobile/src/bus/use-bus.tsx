/** `useBus()` for the phone: the live sockets once paired; nothing at all before that. */
import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { setApi } from '@/api/client';
import { play } from '@/haptics/player';
import type { BusEvent, HapticCommand } from './contracts';
import { initialPhoneState, reducePhone, type PhoneState } from './phone-state';
import { clearPairing, createSocketSource, loadPairing, savePairing, type Pairing, type StoredPairing } from './socket-source';
import type { BusSource, DirectorCommand } from './types';

export interface Buzz extends HapticCommand {
  at: number;
  id: number;
}

export interface BusApi {
  state: PhoneState;
  /** loading: reading storage. unpaired: no laptop, so no data. live: talking to the laptop. */
  mode: 'loading' | 'unpaired' | 'live';
  pairing: Pairing | null;
  /** Buzzes received from the backend (ours and third-party apps'), newest first. */
  buzzes: Buzz[];
  send(command: DirectorCommand): void;
  pair(pairing: Pairing): Promise<void>;
  unpair(): Promise<void>;
  resolveApp(app_id: string): void;
  dismissNotice(): void;
}

const BusContext = createContext<BusApi | null>(null);
const ENV_URL = process.env.EXPO_PUBLIC_BUS_URL?.replace(/\/+$/, '') || null;

export function BusProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducePhone, initialPhoneState);
  const [stored, setStored] = useState<StoredPairing | undefined>(undefined);
  const [buzzes, setBuzzes] = useState<Buzz[]>([]);
  const sourceRef = useRef<BusSource | null>(null);
  const buzzId = useRef(0);

  useEffect(() => {
    loadPairing().then(setStored);
  }, []);

  const pairing = stored ?? null;
  const live: Pairing | null = pairing ?? (ENV_URL ? { server_url: ENV_URL, device_id: '', device_token: '' } : null);
  const mode: BusApi['mode'] = stored === undefined ? 'loading' : live ? 'live' : 'unpaired';
  const liveKey = live ? `${live.server_url}|${live.device_id}|${live.device_token}` : '';
  // Set during render, not in an effect: screens' fetch effects run before this provider's effects.
  setApi(live ? { url: live.server_url, token: live.device_token } : null);

  useEffect(() => {
    if (!live) { dispatch({ type: 'source.changed' }); return; }
    const source = createSocketSource(live);
    sourceRef.current = source;
    dispatch({ type: 'source.changed' });
    source.start({
      onEvent: (event: BusEvent, at?: number) => dispatch({ type: 'event', event, at: at ?? Date.now() }),
      onStatus: (status) => dispatch({ type: 'status', status }),
      onReset: () => dispatch({ type: 'reset' }),
      onHaptic: (cmd) => {
        play(cmd.pattern, cmd.intensity);
        setBuzzes((list) => [{ ...cmd, at: Date.now(), id: ++buzzId.current }, ...list].slice(0, 30));
      },
    });
    return () => { source.stop(); sourceRef.current = null; };
    // the pairing's identity is `liveKey`; `live` is rebuilt every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey]);

  const pair = useCallback(async (p: Pairing) => { await savePairing(p); setStored(p); }, []);
  const unpair = useCallback(async () => { await clearPairing(); setBuzzes([]); setStored(null); }, []);

  const api = useMemo<BusApi>(() => ({
    state, mode, pairing, buzzes,
    send: (command) => sourceRef.current?.send(command),
    pair, unpair,
    resolveApp: (app_id) => dispatch({ type: 'app.resolved', app_id }),
    dismissNotice: () => dispatch({ type: 'notice.dismiss' }),
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

/** Bumps whenever the conversation list may have changed: a session ended, a debrief arrived, the
 *  phone reconnected, or the pairing changed. Screens put it in their fetch effect's deps. No polling. */
export function useListVersion(): string {
  const { state, mode, pairing } = useBus();
  return `${mode}|${pairing?.server_url ?? ''}|${state.resync}|${state.lastEnded?.at ?? 0}|${state.debrief?.at ?? 0}`;
}
