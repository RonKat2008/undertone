'use client';

import React, { useState, useEffect } from 'react';
import { useBus } from '@/lib/bus/use-bus';
import { Glyph } from '@/components/Glyph';
import type { HapticPattern, MotionState, BusEvent } from '@/lib/bus/contracts';

export function DirectorPanel() {
  const [isOpen, setIsOpen] = useState(false);
  
  // Safely extract emit/dispatch from useBus assuming it's returned as an object
  // or is a function itself.
  const busContext = useBus() as { emit?: (ev: unknown) => void; dispatch?: (ev: unknown) => void } | ((ev: unknown) => void);
  const emit = typeof busContext === 'function' ? busContext : (busContext?.emit || busContext?.dispatch);

  const sendEvent = React.useCallback((event: Partial<BusEvent>) => {
    const ev = { ts: Date.now() / 1000, ...event };
    if (typeof emit === 'function') {
      emit(ev);
    } else if (emit && typeof (emit as { emit?: (ev: unknown) => void }).emit === 'function') {
      (emit as { emit?: (ev: unknown) => void }).emit?.(ev);
    }
  }, [emit]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '`') {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          return;
        }
        setIsOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (!isOpen) return null;

  const nudges: Array<{ id: HapticPattern; label: string; msg: string; reason: string }> = [
    { id: 'interrupt', label: 'Interrupt', msg: 'Let them finish', reason: 'interrupted 0.91' },
    { id: 'wrap_up', label: 'Wrap up', msg: 'Ask a question', reason: 'monologue > 60s' },
    { id: 'filler', label: 'Filler', msg: 'Pause', reason: 'hedging 0.84' },
    { id: 'slow_down', label: 'Slow down', msg: 'Slow down', reason: 'pace > 180wpm' },
    { id: 'still', label: 'Still', msg: 'Hands calm', reason: 'fidgeting 0.95' },
    { id: 'success', label: 'Success', msg: 'Great pace', reason: 'success pattern' },
    { id: 'tap', label: 'Tap', msg: 'Acknowledged', reason: 'manual tap' },
    { id: 'approve', label: 'Approve', msg: 'Approve', reason: 'pending action' },
  ];

  const replies: Array<{ id: 'good' | 'talking_too_much' | 'ask_question'; haptic: HapticPattern; label: string }> = [
    { id: 'good', haptic: 'status_good', label: 'Good' },
    { id: 'talking_too_much', haptic: 'status_talking', label: 'Talking too much' },
    { id: 'ask_question', haptic: 'status_ask', label: 'Ask a question' },
  ];

  const triggerNudge = (nudge: typeof nudges[0]) => {
    sendEvent({
      type: 'nudge',
      rule_id: 'director_rule',
      haptic: nudge.id,
      message: nudge.msg,
      reason: nudge.reason,
      confidence: 0.95,
      latency_ms: 150,
      budget_left: 4,
    });
  };

  const triggerReply = (reply: typeof replies[0]) => {
    sendEvent({
      type: 'status.reply',
      verdict: reply.id,
      haptic: reply.haptic,
    });
  };

  const btnClass = "border border-[oklch(0.9_0.0_0)] px-2 py-1.5 text-xs hover:bg-[oklch(0.9_0.0_0)] transition-colors text-left flex items-center justify-between group";

  return (
    <div className="fixed bottom-4 right-4 w-80 bg-[oklch(0.98_0.01_90)] border border-[oklch(0.9_0.0_0)] text-[oklch(0.15_0.01_270)] font-mono text-sm z-50 shadow-2xl flex flex-col max-h-[90vh]">
      <div className="p-3 border-b border-[oklch(0.9_0.0_0)] flex justify-between items-center bg-[oklch(0.96_0.01_90)]">
        <span className="font-bold tracking-tight uppercase text-[10px]">Director Panel</span>
        <button onClick={() => setIsOpen(false)} className="text-[10px] uppercase hover:opacity-50">Close ( ` )</button>
      </div>

      <div className="overflow-y-auto p-3 space-y-5">
        {/* Session */}
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-[oklch(0.5_0.0_0)] mb-2">Session</div>
          <div className="grid grid-cols-2 gap-1">
            <button className={btnClass} onClick={() => sendEvent({ type: 'session.started', session_id: 'mock', coach_id: 'c1', mode: 'regular', policy: { focus_rule_id: 'r1', budget_per_session: 5, min_gap_s: 60, tolerance: 0.3, silent: false }, ts: 0 })}>
              Start
            </button>
            <button className={btnClass} onClick={() => sendEvent({ type: 'session.ended', session_id: 'mock' })}>
              Stop
            </button>
          </div>
        </div>

        {/* Nudges */}
        <div className="space-y-1 pt-3 border-t border-[oklch(0.9_0.0_0)]">
          <div className="text-[10px] uppercase tracking-widest text-[oklch(0.5_0.0_0)] mb-2">Fire Nudge</div>
          <div className="grid grid-cols-2 gap-1">
            {nudges.map(n => (
              <button key={n.id} className={btnClass} onClick={() => triggerNudge(n)}>
                <span>{n.label}</span>
                <div className="w-5 h-3 opacity-30 group-hover:opacity-100 flex items-center justify-center">
                  <Glyph pattern={n.id} playing={false} className="w-full h-full" />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Status Replies */}
        <div className="space-y-1 pt-3 border-t border-[oklch(0.9_0.0_0)]">
          <div className="text-[10px] uppercase tracking-widest text-[oklch(0.5_0.0_0)] mb-2">Status Reply</div>
          <div className="flex flex-col gap-1">
            {replies.map(r => (
              <button key={r.id} className={btnClass} onClick={() => triggerReply(r)}>
                <span>{r.label}</span>
                <div className="w-6 h-3 opacity-30 group-hover:opacity-100 flex items-center justify-center">
                  <Glyph pattern={r.haptic} playing={false} className="w-full h-full" />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Signals */}
        <div className="space-y-1 pt-3 border-t border-[oklch(0.9_0.0_0)]">
          <div className="text-[10px] uppercase tracking-widest text-[oklch(0.5_0.0_0)] mb-2">Events</div>
          <div className="grid grid-cols-2 gap-1">
            <button className={btnClass} onClick={() => sendEvent({ type: 'bookmark', source: 'phone', text: null })}>
              Add Bookmark
            </button>
            <button className={btnClass} onClick={() => sendEvent({ type: 'signal', kind: 'nerves', detail: 'pacing up' })}>
              Signal: Nerves
            </button>
            <button className={btnClass + " col-span-2 justify-center"} onClick={() => sendEvent({ type: 'signal', kind: 'checked_out', detail: 'silent' })}>
              Signal: Checked Out
            </button>
          </div>
        </div>

        {/* Motion State */}
        <div className="space-y-1 pt-3 border-t border-[oklch(0.9_0.0_0)]">
          <div className="text-[10px] uppercase tracking-widest text-[oklch(0.5_0.0_0)] mb-2">Motion</div>
          <div className="grid grid-cols-3 gap-1">
            {(['still', 'gesture', 'fidget'] as MotionState[]).map(m => (
              <button key={m} className={btnClass + " justify-center"} onClick={() => sendEvent({ type: 'motion', state: m, hand_energy: m === 'fidget' ? 0.9 : m === 'gesture' ? 0.5 : 0.1, speaker_context: 'me', confidence: 0.9 })}>
                {m}
              </button>
            ))}
          </div>
        </div>

        {/* Flow */}
        <div className="space-y-1 pt-3 border-t border-[oklch(0.9_0.0_0)]">
          <div className="text-[10px] uppercase tracking-widest text-[oklch(0.5_0.0_0)] mb-2">Flow</div>
          <div className="grid grid-cols-1 gap-1">
            <button className={btnClass + " justify-center"} onClick={() => sendEvent({ type: 'debrief', session_id: 'mock', data: { headline_fact: 'Test Debrief', strength: 'Good', one_fix: 'None', if_then: 'If X then Y', numbers: { talk_ratio: 0.5, interruptions: 0, questions: 1, fillers_per_min: 2, wpm: 120 }, best_moment_quote: 'Yes', vs_last_time: null, notes: [], bookmarks: [], timeline: [], better_version: null }, audio_url: null })}>
              Jump to Debrief
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
