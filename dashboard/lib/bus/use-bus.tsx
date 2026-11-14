'use client';

import React, { createContext, useContext, useEffect, useReducer, useRef } from 'react';
import { BusEvent, MotionState, HapticPattern } from './contracts';
import { busReducer, BusState, Action } from './reducer';
import { MockBusSource } from './mock-source';
import { SocketBusSource, BusSource } from './socket-source';

interface BusContextType {
  state: BusState;
  dispatch: React.Dispatch<Action>;
  injectEvent: (e: BusEvent) => void;
  startSession: () => void;
  stopSession: () => void;
  fireNudge: (haptic: HapticPattern, message: string) => void;
  fireStatusReply: (verdict: 'good' | 'talking_too_much' | 'ask_question', haptic: HapticPattern) => void;
  addBookmark: (source: 'phone' | 'promise', text: string | null) => void;
  triggerSignal: (kind: 'nerves' | 'checked_out', detail: string) => void;
  setMotionState: (state: MotionState, energy: number) => void;
  jumpToDebrief: () => void;
  resetMock: () => void;
}

const BusContext = createContext<BusContextType | null>(null);

export function BusProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(busReducer, undefined, () => busReducer({} as BusState, { type: 'INTERNAL_RESET' }));
  const sourceRef = useRef<BusSource | null>(null);

  useEffect(() => {
    const isMock = !process.env.NEXT_PUBLIC_BUS_URL;
    const source = isMock ? new MockBusSource() : new SocketBusSource();
    sourceRef.current = source;

    const unsubscribe = source.subscribe((e) => {
      dispatch({ type: 'EVENT', event: e });
      if (e.type === 'nudge') {
        setTimeout(() => dispatch({ type: 'CLEAR_ACTIVE_NUDGE' }), 2500);
      }
      if (e.type === 'status.reply') {
        setTimeout(() => dispatch({ type: 'CLEAR_ACTIVE_STATUS_REPLY' }), 2500);
      }
    });

    source.start();

    return () => {
      unsubscribe();
      source.stop();
    };
  }, []);

  const injectEvent = (e: BusEvent) => dispatch({ type: 'EVENT', event: e });
  
  const startSession = () => {
    if (sourceRef.current instanceof MockBusSource) {
      sourceRef.current.stop();
      sourceRef.current.start();
    }
  };
  
  const stopSession = () => {
    if (sourceRef.current instanceof MockBusSource) {
      sourceRef.current.stop();
    }
  };
  
  const fireNudge = (haptic: HapticPattern, message: string) => {
    const ts = Math.floor(Date.now() / 1000);
    const event: BusEvent = { type: 'nudge', rule_id: 'manual', haptic, message, reason: 'Manual trigger', confidence: 1, latency_ms: 0, budget_left: 5, ts };
    injectEvent(event);
    setTimeout(() => dispatch({ type: 'CLEAR_ACTIVE_NUDGE' }), 2500);
  };
  
  const fireStatusReply = (verdict: 'good' | 'talking_too_much' | 'ask_question', haptic: HapticPattern) => {
    const ts = Math.floor(Date.now() / 1000);
    const event: BusEvent = { type: 'status.reply', verdict, haptic, ts };
    injectEvent(event);
    setTimeout(() => dispatch({ type: 'CLEAR_ACTIVE_STATUS_REPLY' }), 2500);
  };
  
  const addBookmark = (source: 'phone' | 'promise', text: string | null) => {
    const ts = Math.floor(Date.now() / 1000);
    injectEvent({ type: 'bookmark', source, text, ts });
  };
  
  const triggerSignal = (kind: 'nerves' | 'checked_out', detail: string) => {
    const ts = Math.floor(Date.now() / 1000);
    injectEvent({ type: 'signal', kind, detail, ts });
  };
  
  const setMotionState = (motionState: MotionState, energy: number) => {
    const ts = Math.floor(Date.now() / 1000);
    injectEvent({ type: 'motion', state: motionState, hand_energy: energy, speaker_context: null, confidence: 1, ts });
  };
  
  const jumpToDebrief = () => dispatch({ type: 'INTERNAL_JUMP_TO_DEBRIEF' });
  
  const resetMock = () => dispatch({ type: 'INTERNAL_RESET' });

  return (
    <BusContext.Provider value={{ state, dispatch, injectEvent, startSession, stopSession, fireNudge, fireStatusReply, addBookmark, triggerSignal, setMotionState, jumpToDebrief, resetMock }}>
      {children}
    </BusContext.Provider>
  );
}

export function useBus() {
  const ctx = useContext(BusContext);
  if (!ctx) throw new Error('useBus must be used within BusProvider');
  return ctx;
}
