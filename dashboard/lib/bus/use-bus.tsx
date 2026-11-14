'use client';

/** `useBus()`: the only place components get live state from: the backend's event socket. */
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { getBusConfig } from '@/lib/config';
import type { BusEvent } from './contracts';
import { initialState, reduce, type BusState } from './reducer';
import { createSocketSource } from './socket-source';
import type { BusSource, DirectorCommand } from './types';

export interface BusApi {
  state: BusState;
  send(command: DirectorCommand): void;
  /** Fold an event in locally (e.g. right after a REST call, before the bus echoes it). */
  inject(event: BusEvent): void;
  resolveApp(app_id: string): void;
}

const BusContext = createContext<BusApi | null>(null);

export function BusProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const sourceRef = useRef<BusSource | null>(null);

  useEffect(() => {
    const config = getBusConfig();
    const source = createSocketSource(config.url);
    sourceRef.current = source;
    source.start({
      onEvent: (event, at) => dispatch({ type: 'event', event, at: at ?? Date.now() }),
      onStatus: (status) => dispatch({ type: 'status', status }),
      onReset: () => dispatch({ type: 'reset' }),
    });
    return () => {
      source.stop();
      sourceRef.current = null;
    };
  }, []);

  const api = useMemo<BusApi>(() => ({
    state,
    send: (command) => sourceRef.current?.send(command),
    inject: (event) => dispatch({ type: 'event', event, at: Date.now() }),
    resolveApp: (app_id) => dispatch({ type: 'app.resolved', app_id }),
  }), [state]);

  return <BusContext.Provider value={api}>{children}</BusContext.Provider>;
}

export function useBus(): BusApi {
  const api = useContext(BusContext);
  if (!api) throw new Error('useBus() must be used inside <BusProvider>');
  return api;
}

/** Re-render on an interval; returns the current wall-clock ms. Used for clocks and fade-outs. */
export function useNow(intervalMs = 250): number {
  const [now, tick] = useReducer(() => Date.now(), 0);
  useEffect(() => {
    tick();
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
