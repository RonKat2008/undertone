import React, { createContext, useContext, useEffect, useReducer, useRef } from 'react';
import { BusEvent, MotionState } from './contracts';
import { busReducer, initialBusState, BusState, BusAction } from './reducer';
import { SocketBusSource } from './socket-source';
import { MockBusSource } from './mock-source';

interface BusContextType {
  state: BusState;
  dispatch: React.Dispatch<BusAction>;
  injectEvent: (e: BusEvent) => void;
  startSession: () => void;
  stopSession: () => void;
  fireNudge: () => void;
  fireStatusReply: () => void;
  addBookmark: () => void;
  triggerSignal: () => void;
  setMotionState: (state: MotionState) => void;
  jumpToDebrief: () => void;
  resetMock: () => void;
}

const BusContext = createContext<BusContextType | null>(null);

export const BusProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, dispatch] = useReducer(busReducer, initialBusState);
  const sourceRef = useRef<MockBusSource | SocketBusSource | null>(null);

  useEffect(() => {
    const isReal = !!process.env.EXPO_PUBLIC_BUS_URL;
    sourceRef.current = isReal ? new SocketBusSource() : new MockBusSource();
    
    const unsub = sourceRef.current.subscribe(e => {
      dispatch({ type: 'event', event: e });
    });
    
    sourceRef.current.start();
    
    const ticker = setInterval(() => dispatch({ type: 'tick' }), 1000);

    return () => {
      unsub();
      sourceRef.current?.stop();
      clearInterval(ticker);
    };
  }, []);

  const api: BusContextType = {
    state,
    dispatch,
    injectEvent: (e) => dispatch({ type: 'event', event: e }),
    startSession: () => sourceRef.current?.start(),
    stopSession: () => sourceRef.current?.stop(),
    fireNudge: () => dispatch({ type: 'event', event: { type: 'nudge', rule_id: 'test', haptic: 'tap', message: 'Test Nudge', reason: 'Test', confidence: 1, latency_ms: 100, budget_left: 5, ts: state.elapsedS } }),
    fireStatusReply: () => dispatch({ type: 'event', event: { type: 'status.reply', verdict: 'good', haptic: 'status_good', ts: state.elapsedS } }),
    addBookmark: () => dispatch({ type: 'event', event: { type: 'bookmark', source: 'phone', text: 'Bookmark added', ts: state.elapsedS } }),
    triggerSignal: () => dispatch({ type: 'event', event: { type: 'signal', kind: 'nerves', detail: 'User triggered', ts: state.elapsedS } }),
    setMotionState: (mState: MotionState) => dispatch({ type: 'event', event: { type: 'motion', state: mState, hand_energy: 0.5, speaker_context: null, confidence: 1, ts: state.elapsedS } }),
    jumpToDebrief: () => dispatch({ type: 'jump_to_debrief' }),
    resetMock: () => { dispatch({ type: 'reset' }); sourceRef.current?.stop(); sourceRef.current?.start(); }
  };

  return <BusContext.Provider value={api}>{children}</BusContext.Provider>;
};

export function useBus() {
  const ctx = useContext(BusContext);
  if (!ctx) throw new Error('useBus must be used inside BusProvider');
  return ctx;
}
