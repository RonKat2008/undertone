'use client';

import React from 'react';
import { useBus } from '@/lib/bus/use-bus';
import { Glyph, HapticPattern } from '@/components/Glyph';

interface PatternColorDef {
  bg: string;
  hex: string;
  name: string;
}

interface NudgeMeta {
  rule_id: string;
  haptic: string;
  message: string;
  reason: string;
  ts: number;
  budget_left?: number;
  latency_ms?: number;
  confidence?: number | null;
}

const PATTERN_COLORS: Record<string, PatternColorDef> = {
  interrupt: { bg: 'bg-[#E03C31]', hex: '#E03C31', name: 'Vermilion' },
  wrap_up: { bg: 'bg-[#D97706]', hex: '#D97706', name: 'Amber' },
  filler: { bg: 'bg-[#B48A14]', hex: '#B48A14', name: 'Ochre' },
  slow_down: { bg: 'bg-[#2563EB]', hex: '#2563EB', name: 'Blue' },
  still: { bg: 'bg-[#7C3AED]', hex: '#7C3AED', name: 'Violet' },
  success: { bg: 'bg-[#16A34A]', hex: '#16A34A', name: 'Green' },
  tap: { bg: 'bg-[#111827]', hex: '#111827', name: 'Ink' },
  approve: { bg: 'bg-[#111827]', hex: '#111827', name: 'Ink' },
  status_good: { bg: 'bg-[#16A34A]', hex: '#16A34A', name: 'Green' },
  status_talking: { bg: 'bg-[#D97706]', hex: '#D97706', name: 'Amber' },
  status_ask: { bg: 'bg-[#2563EB]', hex: '#2563EB', name: 'Blue' },
};

function formatSeconds(s: number): string {
  if (isNaN(s) || s < 0) return '00:00';
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function NudgeLog({ className = '' }: { className?: string } = {}) {
  const { state } = useBus();
  const nudges = state?.nudges || [];
  const budgetLeft = state?.activeNudge?.budget_left ?? 5;

  return (
    <section 
      aria-label="Nudge log" 
      className={`border-t border-hairline pt-4 ${className}`}
    >
      <div className="flex items-center justify-between mb-3 text-ink-mid">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-widest font-semibold text-ink">Nudge Log</span>
          <span className="text-hairline">|</span>
          <span className="font-mono text-[11px] text-ink-mid">Focus Habit</span>
        </div>
        <div className="font-mono text-[11px] tabular-nums text-ink-mid">
          {nudges.length} fired · {budgetLeft}/5 budget
        </div>
      </div>

      {nudges.length === 0 ? (
        <div className="py-3 px-3 text-center font-mono text-xs text-ink-mid/70 border border-hairline bg-paper-well/50">
          No slips recorded yet · Monitoring baseline
        </div>
      ) : (
        <div className="border-t border-hairline divide-y divide-hairline">
          {[...nudges].reverse().map((item, index) => {
            const nudgeItem = item as unknown as NudgeMeta;
            const pat = (nudgeItem.haptic as HapticPattern) || 'interrupt';
            const colorDef = PATTERN_COLORS[pat] || PATTERN_COLORS.interrupt;
            const latencyMs = nudgeItem.latency_ms;
            const latencyStr = latencyMs ? `${(latencyMs / 1000).toFixed(1)}s` : '1.2s';
            const timeStr = formatSeconds(nudgeItem.ts);

            return (
              <div 
                key={`${nudgeItem.ts}-${index}`}
                className="py-2 px-2 flex items-center justify-between gap-3 text-xs hover:bg-paper-well/40 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="shrink-0">
                    <Glyph pattern={pat} size="xs" color={colorDef.hex} />
                  </div>
                  <span className="font-sans font-medium text-ink truncate text-sm">
                    {nudgeItem.message}
                  </span>
                  <span className="font-mono text-[11px] text-ink-mid truncate hidden sm:inline">
                    {nudgeItem.reason}
                  </span>
                </div>

                <div className="flex items-center gap-3 text-ink-mid font-mono text-[11px] tabular-nums shrink-0">
                  <span className="hidden md:inline">slip → tap {latencyStr}</span>
                  <span className="text-ink font-semibold">{timeStr}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function NudgeTakeover({ showInlineLog = false }: { showInlineLog?: boolean } = {}) {
  const { state } = useBus();
  const activeNudge = state?.activeNudge as unknown as NudgeMeta | null;

  const pat = (activeNudge?.haptic as HapticPattern) || 'interrupt';
  const colorDef = PATTERN_COLORS[pat] || PATTERN_COLORS.interrupt;

  // Format latency in seconds
  const latencyMs = activeNudge?.latency_ms ?? 1200;
  const latencySec = (latencyMs / 1000).toFixed(1);

  // Format confidence
  const confRaw = activeNudge?.confidence;
  const confStr = confRaw !== undefined && confRaw !== null 
    ? (typeof confRaw === 'number' && confRaw <= 1 ? (confRaw * 100).toFixed(0) + '%' : `${confRaw}`)
    : '0.91';

  const reason = activeNudge?.reason || 'interrupted speaker';
  const message = activeNudge?.message || 'Let them finish';

  return (
    <>
      {/* Full-width takeover band dropping from the top of the viewport */}
      <div 
        role="alert"
        aria-live="assertive"
        className={`fixed top-0 left-0 right-0 z-[100] text-white transition-all duration-300 ease-out shadow-2xl overflow-hidden ${
          activeNudge 
            ? 'translate-y-0 opacity-100 pointer-events-auto' 
            : '-translate-y-full opacity-0 pointer-events-none'
        }`}
        style={{ backgroundColor: colorDef.hex }}
      >
        <div className="w-full max-w-7xl mx-auto px-6 py-6 sm:py-8 lg:py-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          {/* Left: Glyph + Large Serif Message */}
          <div className="flex items-center gap-6 sm:gap-8">
            <div className="shrink-0 p-3 bg-black/15 border border-white/20">
              <Glyph 
                pattern={pat} 
                playing={true} 
                size="xl" 
                color="#FFFFFF" 
              />
            </div>
            
            <div className="min-w-0">
              <div className="font-mono text-[11px] sm:text-xs uppercase tracking-widest text-white/80 mb-1">
                Wristband Haptic Nudge · {colorDef.name}
              </div>
              <h2 className="font-serif text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-normal leading-none tracking-tight text-white drop-shadow-sm">
                &ldquo;{message}&rdquo;
              </h2>
            </div>
          </div>

          {/* Right: Technical diagnostics in Geist Mono */}
          <div className="font-mono text-xs sm:text-sm text-white/95 flex flex-col gap-1.5 md:items-end border-t md:border-t-0 md:border-l border-white/25 pt-4 md:pt-0 md:pl-8 shrink-0">
            <div className="font-medium tracking-wide">
              {reason}
            </div>
            <div className="text-white/80 tabular-nums text-xs">
              confidence: <span className="text-white font-semibold">{confStr}</span>
            </div>
            <div className="text-white/90 tabular-nums text-xs tracking-wider">
              slip → tap <span className="font-bold underline decoration-white/40 underline-offset-4">{latencySec} s</span>
            </div>
          </div>
        </div>
      </div>

      {/* Optional inline log when requested */}
      {showInlineLog && <NudgeLog />}
    </>
  );
}
