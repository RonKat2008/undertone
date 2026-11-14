'use client';

import React from 'react';
import { useBus } from '@/lib/bus/use-bus';
import { Glyph } from '@/components/Glyph';
import { HandEnergyMeter } from './HandEnergyMeter';
import { HapticPattern, VolumeState } from '@/lib/bus/contracts';

export interface InstrumentsRailProps {
  className?: string;
}

export function InstrumentsRail({ className = '' }: InstrumentsRailProps = {}) {
  const { state } = useBus();

  // 1. Focus & Budget
  const activeCoach = state?.activeCoach;
  const policy = state?.policy || activeCoach?.nudge_policy;
  const mode = (state?.mode || 'regular').toUpperCase();

  // Find focus rule in coach nudge_rules
  const focusRule = activeCoach?.nudge_rules?.find(r => r.id === policy?.focus_rule_id);
  const focusName = focusRule?.message || activeCoach?.goal || 'Let them finish';
  const focusPattern = (focusRule?.haptic || 'interrupt') as HapticPattern;

  const totalBudget = policy?.budget_per_session ?? 5;
  const lastNudge = state?.nudges && state.nudges.length > 0 
    ? (state.nudges[state.nudges.length - 1] as { budget_left?: number }) 
    : null;
  const budgetLeft = typeof state?.activeNudge?.budget_left === 'number'
    ? state.activeNudge.budget_left
    : typeof lastNudge?.budget_left === 'number'
      ? lastNudge.budget_left
      : Math.max(0, totalBudget - (state?.nudges?.length || 0));

  // 2. Pace
  const metrics = state?.metrics;
  const wpm = metrics?.wpm ? Math.round(metrics.wpm) : 142;
  const baselineWpm = metrics?.baseline_wpm ? Math.round(metrics.baseline_wpm) : 150;
  const paceDiff = wpm - baselineWpm;

  // Pace rolling sparkline history
  const paceHistory = (state?.metricsHistory && state.metricsHistory.length > 0)
    ? state.metricsHistory.map(m => m.wpm)
    : [144, 146, 149, 151, 147, 143, 140, 145, 148, wpm];
  const recentPace = paceHistory.slice(-20);
  const paceTrace = recentPace.length < 2 ? [wpm, wpm] : recentPace;

  // Pace sparkline coordinates (viewBox 0 0 200 36)
  const paceSvgW = 200;
  const paceSvgH = 36;
  const paceMin = Math.min(...paceTrace, baselineWpm - 15);
  const paceMax = Math.max(...paceTrace, baselineWpm + 15);
  const paceRange = Math.max(10, paceMax - paceMin);

  const pacePointsStr = paceTrace.map((val, idx) => {
    const x = (idx / (paceTrace.length - 1)) * paceSvgW;
    const y = paceSvgH - ((val - paceMin) / paceRange) * paceSvgH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const baselineY = paceSvgH - ((baselineWpm - paceMin) / paceRange) * paceSvgH;
  const latestPaceVal = paceTrace[paceTrace.length - 1];
  const latestPaceX = paceSvgW;
  const latestPaceY = paceSvgH - ((latestPaceVal - paceMin) / paceRange) * paceSvgH;

  // 3. Volume
  const volumeDb = metrics?.volume_db ?? -18.4;
  const volumeState: VolumeState = metrics?.volume_state ?? (volumeDb < -24 ? 'quiet' : volumeDb > -14 ? 'loud' : 'ok');

  // 4. Counters
  const fillersPerMin = metrics?.fillers_per_min ?? 0;
  const questions = metrics?.questions ?? 0;
  const interruptions = metrics?.interruptions ?? 0;

  // 5. Monologue Timer
  const monologueS = metrics?.monologue_s ?? 0;
  const monologueLimit = 45; // seconds
  const monologueWarning = 30; // seconds
  const monologueProgress = Math.min(100, (monologueS / monologueLimit) * 100);

  // Monologue warming color
  const monologueColorClass = monologueS >= monologueWarning
    ? monologueS >= monologueLimit
      ? 'text-p-wrap-up font-semibold'
      : 'text-p-wrap-up font-medium'
    : 'text-ink font-light';

  const monologueBarClass = monologueS >= monologueWarning
    ? 'bg-p-wrap-up'
    : 'bg-ink';

  return (
    <aside 
      className={`w-full max-w-sm flex flex-col bg-paper divide-y divide-hairline border-l border-hairline font-sans ${className}`}
      aria-label="Instruments rail"
    >
      {/* 1. Focus & Budget Section */}
      <section className="p-4 flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-mono tracking-widest text-ink-mid uppercase">
            Focus &amp; Budget
          </span>
          <span className="text-[10px] font-mono tracking-wider text-ink px-1.5 py-0.5 border border-hairline bg-paper-well">
            {mode}
          </span>
        </div>

        {/* Active Focus Habit */}
        <div className="flex items-center gap-3 py-1">
          <div className="flex-shrink-0 p-1.5 border border-hairline bg-paper-well">
            <Glyph pattern={focusPattern} size="sm" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-mono uppercase tracking-wider text-ink-mid">
              Focus Habit
            </div>
            <div className="text-sm font-medium text-ink truncate" title={focusName}>
              {focusName}
            </div>
          </div>
        </div>

        {/* Buzz Budget: 5 crisp marks spent one by one */}
        <div className="flex items-center justify-between pt-1 border-t border-hairline">
          <div className="flex flex-col">
            <span className="text-[10px] font-mono tracking-widest text-ink-mid uppercase">
              Buzz Budget
            </span>
            <span className="text-xs font-mono tabular-nums text-ink">
              {budgetLeft} of {totalBudget} remaining
            </span>
          </div>

          <div className="flex items-center gap-1.5" aria-label={`Buzz budget ${budgetLeft} of ${totalBudget}`}>
            {Array.from({ length: totalBudget }).map((_, i) => {
              const isAvailable = i < budgetLeft;
              return (
                <div
                  key={i}
                  className={`h-5 w-2.5 transition-colors border ${
                    isAvailable
                      ? 'bg-ink border-ink'
                      : 'bg-paper-well border-hairline opacity-40'
                  }`}
                  title={isAvailable ? `Mark ${i + 1}: Available` : `Mark ${i + 1}: Spent`}
                />
              );
            })}
          </div>
        </div>
      </section>

      {/* 2. Pace Section */}
      <section className="p-4 flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-mono tracking-widest text-ink-mid uppercase">
            Pace
          </span>
          <span className="text-[10px] font-mono tracking-wider text-ink-mid">
            Baseline {baselineWpm} wpm
          </span>
        </div>

        {/* Large Pace readout */}
        <div className="flex items-baseline gap-2">
          <span className="font-mono tabular-nums text-5xl font-light text-ink tracking-tight leading-none">
            {wpm}
          </span>
          <div className="flex flex-col">
            <span className="text-[10px] font-mono tracking-widest text-ink-mid uppercase">
              WPM
            </span>
            <span className="text-xs font-mono tabular-nums text-ink-mid">
              {paceDiff > 0 ? `+${paceDiff}` : paceDiff < 0 ? `${paceDiff}` : '±0'} vs base
            </span>
          </div>
        </div>

        {/* Rolling Pace Sparkline with Baseline Band */}
        <div className="space-y-1 pt-1">
          <div className="w-full bg-paper-well border border-hairline p-1">
            <svg 
              viewBox={`0 0 ${paceSvgW} ${paceSvgH}`} 
              className="w-full h-8 overflow-visible"
              preserveAspectRatio="none"
              aria-label="Rolling pace sparkline"
            >
              {/* Baseline corridor band (±5 wpm) */}
              <line 
                x1="0" 
                y1={baselineY} 
                x2={paceSvgW} 
                y2={baselineY} 
                stroke="currentColor" 
                strokeDasharray="2 3" 
                strokeWidth="1" 
                className="text-hairline" 
              />

              {/* Sparkline trace */}
              <polyline 
                points={pacePointsStr} 
                fill="none" 
                stroke="currentColor" 
                strokeWidth="1.5" 
                strokeLinecap="round" 
                strokeLinejoin="round" 
                className="text-ink" 
              />

              {/* Latest pace dot */}
              <circle 
                cx={latestPaceX} 
                cy={latestPaceY} 
                r="2.5" 
                fill="currentColor" 
                className="text-ink" 
              />
            </svg>
          </div>
        </div>
      </section>

      {/* 3. Volume Section */}
      <section className="p-4 flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-mono tracking-widest text-ink-mid uppercase">
            Volume
          </span>
          <span className="text-[10px] font-mono tracking-wider text-ink-mid">
            Base ~ -20 dBFS
          </span>
        </div>

        <div className="flex items-baseline justify-between">
          <span className="font-mono tabular-nums text-2xl font-light text-ink leading-none">
            {volumeDb.toFixed(1)}{' '}
            <span className="text-xs text-ink-mid uppercase tracking-normal">dBFS</span>
          </span>
          <span className="text-xs font-mono uppercase tracking-wider text-ink-mid">
            Level: {volumeState}
          </span>
        </div>

        {/* Quiet / OK / Loud stepped meter */}
        <div className="grid grid-cols-3 gap-1 pt-1 text-[11px] font-mono text-center">
          <div 
            className={`py-1 border transition-colors ${
              volumeState === 'quiet'
                ? 'border-ink text-ink bg-ink/10 font-medium'
                : 'border-hairline text-ink-mid/60'
            }`}
          >
            quiet
          </div>
          <div 
            className={`py-1 border transition-colors ${
              volumeState === 'ok'
                ? 'border-p-success text-p-success bg-p-success/10 font-medium'
                : 'border-hairline text-ink-mid/60'
            }`}
          >
            ok
          </div>
          <div 
            className={`py-1 border transition-colors ${
              volumeState === 'loud'
                ? 'border-p-interrupt text-p-interrupt bg-p-interrupt/10 font-medium'
                : 'border-hairline text-ink-mid/60'
            }`}
          >
            loud
          </div>
        </div>
      </section>

      {/* 4. Counters Section (Fillers / Questions / Interruptions) */}
      <section className="p-4 grid grid-cols-3 divide-x divide-hairline">
        {/* Fillers per min */}
        <div className="pr-2 flex flex-col">
          <span className="text-[9px] font-mono tracking-widest text-ink-mid uppercase">
            Fillers/m
          </span>
          <span className="font-mono tabular-nums text-2xl font-light text-ink mt-0.5">
            {fillersPerMin.toFixed(1)}
          </span>
        </div>

        {/* Questions */}
        <div className="px-2 flex flex-col">
          <span className="text-[9px] font-mono tracking-widest text-ink-mid uppercase">
            Questions
          </span>
          <span className="font-mono tabular-nums text-2xl font-light text-ink mt-0.5">
            {questions}
          </span>
        </div>

        {/* Interruptions */}
        <div className="pl-2 flex flex-col">
          <span className="text-[9px] font-mono tracking-widest text-ink-mid uppercase">
            Interrupts
          </span>
          <span className={`font-mono tabular-nums text-2xl font-light mt-0.5 ${
            interruptions > 0 ? 'text-p-interrupt' : 'text-ink'
          }`}>
            {interruptions}
          </span>
        </div>
      </section>

      {/* 5. Monologue Timer Section */}
      <section className="p-4 flex flex-col gap-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-mono tracking-widest text-ink-mid uppercase">
            Monologue
          </span>
          <span className="text-[10px] font-mono tracking-wider text-ink-mid">
            Target &lt; 30s
          </span>
        </div>

        {/* Timer readout warming to amber */}
        <div className="flex items-baseline justify-between">
          <div className="flex items-baseline gap-2">
            <span className={`font-mono tabular-nums text-3xl leading-none transition-colors ${monologueColorClass}`}>
              {monologueS}s
            </span>
            <span className="font-mono text-xs text-ink-mid">
              / {monologueLimit}s max
            </span>
          </div>

          <span className={`text-[10px] font-mono uppercase tracking-wider ${
            monologueS >= monologueWarning ? 'text-p-wrap-up' : 'text-ink-mid'
          }`}>
            {monologueS >= monologueLimit 
              ? 'Wrap up now' 
              : monologueS >= monologueWarning 
                ? 'Nearing limit' 
                : 'Turn active'}
          </span>
        </div>

        {/* Progress Bar warming toward amber */}
        <div className="space-y-1">
          <div className="relative h-2 w-full bg-paper-well border border-hairline overflow-hidden">
            {/* 30s guide mark */}
            <div 
              className="absolute top-0 bottom-0 w-px bg-hairline z-10"
              style={{ left: `${(monologueWarning / monologueLimit) * 100}%` }}
              title="30s soft limit"
            />
            {/* Filled progress */}
            <div 
              className={`h-full transition-[width,background-color] duration-300 ease-out ${monologueBarClass}`}
              style={{ width: `${monologueProgress}%` }}
            />
          </div>
          <div className="flex justify-between items-center text-[9px] font-mono text-ink-mid px-0.5">
            <span>0s</span>
            <span style={{ marginLeft: '45%' }}>30s mark</span>
            <span>45s</span>
          </div>
        </div>
      </section>

      {/* 6. Hand Energy Meter Section */}
      <section className="p-4">
        <HandEnergyMeter />
      </section>
    </aside>
  );
}
