'use client';

import React from 'react';
import { useBus } from '@/lib/bus/use-bus';
import { Glyph, HapticPattern } from '@/components/Glyph';

interface StatusDef {
  label: string;
  meaning: string;
  count: string;
  colorHex: string;
}

const STATUS_MAP: Record<string, StatusDef> = {
  good: {
    label: 'Good',
    meaning: 'Pace & volume on target',
    count: '1 buzz',
    colorHex: '#16A34A',
  },
  talking_too_much: {
    label: 'Talking too much',
    meaning: 'Yield the floor',
    count: '2 buzzes',
    colorHex: '#D97706',
  },
  ask_question: {
    label: 'Ask a question',
    meaning: 'Pass the turn',
    count: '3 buzzes',
    colorHex: '#2563EB',
  },
};

export function StatusReplyPill({ className = '' }: { className?: string } = {}) {
  const { state } = useBus();
  const reply = state?.activeStatusReply;

  const verdict = reply?.verdict || 'good';
  const statusInfo = STATUS_MAP[verdict] || STATUS_MAP.good;
  const haptic = (reply?.haptic as HapticPattern) || (verdict === 'talking_too_much' ? 'status_talking' : verdict === 'ask_question' ? 'status_ask' : 'status_good');

  return (
    <aside 
      aria-label="Status reply"
      className={`fixed top-16 right-4 sm:right-8 z-40 transition-all duration-200 ease-out ${
        reply 
          ? 'translate-y-0 opacity-100 pointer-events-auto' 
          : '-translate-y-2 opacity-0 pointer-events-none'
      } ${className}`}
    >
      <div className="bg-paper border-2 border-ink shadow-lg px-4 py-3 flex items-center gap-4 max-w-xs sm:max-w-md select-none">
        {/* Count Glyph */}
        <div className="shrink-0 p-1 bg-paper-well border border-hairline">
          <Glyph 
            pattern={haptic} 
            playing={true} 
            size="sm" 
            color={statusInfo.colorHex} 
          />
        </div>

        {/* Text info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-mono text-[9px] uppercase tracking-widest text-ink-mid font-semibold">
              Tap Query · {statusInfo.count}
            </span>
          </div>
          <div className="font-sans font-semibold text-sm text-ink leading-tight truncate">
            {statusInfo.label}
          </div>
          <div className="font-mono text-[11px] text-ink-mid leading-tight">
            {statusInfo.meaning}
          </div>
        </div>
      </div>
    </aside>
  );
}
