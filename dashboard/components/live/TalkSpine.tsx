'use client';

import React from 'react';
import { useBus } from '@/lib/bus/use-bus';

export function TalkSpine({ className = '' }: { className?: string } = {}) {
  const { state } = useBus();

  // Metrics talk_ratio is 0..1 representing wearer's share of speaking time
  // If not yet available from metrics event, infer from final turns or default to 0.50
  let talkRatio = state.metrics?.talk_ratio;

  if (talkRatio === undefined || talkRatio === null) {
    if (state.turns && state.turns.length > 0) {
      let meSeconds = 0;
      let otherSeconds = 0;
      for (const turn of state.turns) {
        const duration = Math.max(0, turn.end - turn.start);
        if (turn.speaker === 'me') {
          meSeconds += duration;
        } else {
          otherSeconds += duration;
        }
      }
      const total = meSeconds + otherSeconds;
      talkRatio = total > 0 ? meSeconds / total : 0.5;
    } else {
      talkRatio = 0.5;
    }
  }

  // Bound to 0..1
  const clampedRatio = Math.max(0, Math.min(1, talkRatio));
  const mePct = Math.round(clampedRatio * 100);
  const otherPct = 100 - mePct;

  // Coach's target talk ratio (standard 50% target for balanced dialogue)
  const targetRatio = 0.5;
  const targetPct = Math.round(targetRatio * 100);
  const delta = mePct - targetPct;

  return (
    <section 
      aria-label="Talk ratio spine" 
      className={`w-full bg-paper border-b border-hairline py-4 px-4 sm:px-6 select-none ${className}`}
    >
      {/* Top metrics summary line */}
      <div className="flex flex-wrap items-baseline justify-between gap-y-2 mb-3">
        {/* Left: label and primary large mono figure */}
        <div className="flex items-baseline gap-3 sm:gap-4">
          <span className="font-mono text-xs uppercase tracking-widest text-ink-mid">
            Talk Ratio
          </span>
          <span 
            className="font-mono text-4xl sm:text-5xl lg:text-6xl tabular-nums font-normal tracking-tight text-ink leading-none"
            title={`${mePct}% speaking time by wearer`}
          >
            {mePct}%
          </span>
          <span className="font-mono text-xs text-ink-mid hidden sm:inline">
            me {delta > 0 ? `(+${delta}% vs target)` : delta < 0 ? `(${delta}% vs target)` : '(on target)'}
          </span>
        </div>

        {/* Right: legend and target marker readout */}
        <div className="flex items-center gap-4 sm:gap-6 font-mono text-xs tabular-nums text-ink-mid">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-ink inline-block" aria-hidden="true" />
            <span className="text-ink">
              <span className="hidden sm:inline">me </span>{mePct}%
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 bg-other inline-block" aria-hidden="true" />
            <span className="text-ink">
              <span className="hidden sm:inline">other </span>{otherPct}%
            </span>
          </div>

          <div className="flex items-center gap-1.5 pl-3 border-l border-hairline">
            <span className="text-ink-mid uppercase tracking-wider text-[10px]">target</span>
            <span className="text-ink font-medium">{targetPct}%</span>
          </div>
        </div>
      </div>

      {/* Full-width talk-ratio bar across the top */}
      <div className="relative pt-1 pb-2">
        {/* Crisp target hairline indicator tick (above bar) */}
        <div 
          className="absolute top-0 w-[1px] h-1.5 bg-ink pointer-events-none -translate-x-1/2 z-20"
          style={{ left: `${targetPct}%` }}
          aria-hidden="true"
        />

        {/* Track */}
        <div 
          role="progressbar"
          aria-valuenow={mePct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Talk ratio: ${mePct}% me, ${otherPct}% other, target ${targetPct}%`}
          className="relative w-full h-3 sm:h-3.5 bg-other overflow-hidden"
        >
          {/* Me portion (ink) with smooth CSS transition */}
          <div 
            className="h-full bg-ink transition-[width] duration-700 ease-out will-change-[width]"
            style={{ width: `${mePct}%` }}
          />

          {/* Crisp vertical hairline marking the coach's target across the bar */}
          <div 
            className="absolute inset-y-0 w-[1px] bg-paper pointer-events-none -translate-x-1/2 z-10 opacity-90"
            style={{ left: `${targetPct}%` }}
            aria-hidden="true"
          />
        </div>

        {/* Crisp target hairline indicator tick (below bar) */}
        <div 
          className="absolute bottom-0.5 w-[1px] h-1.5 bg-ink pointer-events-none -translate-x-1/2 z-20"
          style={{ left: `${targetPct}%` }}
          aria-hidden="true"
        />
      </div>

      {/* Technical ruler ticks */}
      <div className="flex justify-between font-mono text-[10px] tabular-nums text-ink-mid px-0.5 pt-0.5 select-none" aria-hidden="true">
        <span>0%</span>
        <span className="hidden sm:inline">25%</span>
        <span className="font-medium text-ink">50% target</span>
        <span className="hidden sm:inline">75%</span>
        <span>100%</span>
      </div>
    </section>
  );
}
