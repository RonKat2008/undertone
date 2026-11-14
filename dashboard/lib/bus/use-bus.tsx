'use client';

/** `useBus()`: the only place components get live state from. Mock or socket, same interface. */
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { getBusConfig } from '@/lib/config';
import type { BusEvent } from './contracts';
import { createMockSource } from './mock-source';
import { initialState, reduce, type BusState } from './reducer';
import { createSocketSource } from './socket-source';
import type { BusSource, DirectorCommand } from './types';

export interface BusApi {
  state: BusState;
  /** 'mock' or 'socket' */
  kind: BusSource['kind'];
  send(command: DirectorCommand): void;
  /** Fold an event in locally (e.g. after a REST call in mock mode). */
  inject(event: BusEvent): void;
  resolveApp(app_id: string): void;
}

const BusContext = createContext<BusApi | null>(null);

export function BusProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reduce, initialState);
  const sourceRef = useRef<BusSource | null>(null);

  useEffect(() => {
    const config = getBusConfig();
    const source = config.url ? createSocketSource(config.url) : createMockSource({ startAt: config.startAt, freeze: config.freeze, speed: config.speed });
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
    kind: state.status === 'mock' ? 'mock' : 'socket',
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
