'use client';

import React from 'react';
import { useBus } from '@/lib/bus/use-bus';
import { MotionState, Speaker } from '@/lib/bus/contracts';

export interface HandEnergyMeterProps {
  className?: string;
}

export function HandEnergyMeter({ className = '' }: HandEnergyMeterProps = {}) {
  const { state } = useBus();

  // Read current hand energy: 0 frozen, ~0.5 natural gesturing, 1 overdoing it
  const rawEnergy = state?.motion?.hand_energy ?? state?.metrics?.hand_energy ?? 0.45;
  const energy = Math.max(0, Math.min(1, rawEnergy));

  // Current motion state: 'still' | 'gesture' | 'fidget'
  const motionState: MotionState = state?.motion?.state
    ?? (energy < 0.25 ? 'still' : energy > 0.75 ? 'fidget' : 'gesture');

  // Speaker context: 'me' | 'other'
  const speakerContext: Speaker = (state?.motion?.speaker_context === 'other' || state?.motion?.speaker_context === 'me')
    ? state.motion.speaker_context
    : (state?.partialTranscript?.speaker === 'other' ? 'other' : 'me');

  // Zone classification
  const zoneLabel = energy < 0.25 
    ? 'Frozen' 
    : energy > 0.75 
      ? 'Overdoing it' 
      : 'Natural gesturing';

  // Recent trace samples for SVG sparkline
  const historySamples = (state?.metricsHistory && state.metricsHistory.length > 0)
    ? state.metricsHistory.map(m => m.hand_energy)
    : (state?.motionHistory && state.motionHistory.length > 0)
      ? state.motionHistory.map(m => m.hand_energy)
      : [0.42, 0.45, 0.48, 0.52, 0.49, 0.44, 0.46, 0.5, 0.48, energy];

  const recentPoints = historySamples.slice(-20);
  const trace = recentPoints.length < 2 ? [energy, energy] : recentPoints;

  // Sparkline coordinates (viewBox 0 0 200 40)
  const svgW = 200;
  const svgH = 40;
  const pointsStr = trace.map((val, idx) => {
    const clamped = Math.max(0, Math.min(1, val));
    const x = (idx / (trace.length - 1)) * svgW;
    const y = svgH - clamped * svgH;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');

  const latestVal = trace[trace.length - 1];
  const latestX = svgW;
  const latestY = svgH - Math.max(0, Math.min(1, latestVal)) * svgH;

  return (
    <div className={`flex flex-col gap-3 font-sans ${className}`}>
      {/* Section Header */}
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] font-mono tracking-widest text-ink-mid uppercase">
          Hand Energy
        </span>
        <span className="text-[10px] font-mono tracking-wider text-ink-mid uppercase">
          {zoneLabel}
        </span>
      </div>

      {/* Numeric readout & primary continuous gauge */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="font-mono tabular-nums text-3xl font-light text-ink leading-none">
            {energy.toFixed(2)}
          </span>
          <span className="font-mono text-xs text-ink-mid">
            / 1.00
          </span>
        </div>

        {/* Status pill for current context */}
        <div className="flex items-center gap-2">
          <span 
            className={`text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 border ${
              speakerContext === 'me'
                ? 'border-ink text-ink bg-ink/5'
                : 'border-other text-other bg-other/5'
            }`}
          >
            {speakerContext === 'me' ? 'me speaking' : 'listening'}
          </span>
        </div>
      </div>

      {/* Continuous 0-1 Gauge Meter with comfortable middle marked */}
      <div className="space-y-1">
        <div className="relative h-3.5 w-full bg-paper-well border border-hairline overflow-hidden">
          {/* Natural gesturing middle band (0.25 to 0.75) */}
          <div 
            className="absolute top-0 bottom-0 bg-ink/[0.06] border-x border-hairline/80"
            style={{ left: '25%', width: '50%' }}
            title="Natural gesturing zone (0.25 - 0.75)"
          />

          {/* Reference tick at center 0.50 */}
          <div 
            className="absolute top-0 bottom-0 w-px bg-hairline"
            style={{ left: '50%' }}
          />

          {/* Live needle indicator */}
          <div 
            className="absolute top-0 bottom-0 w-[2px] -ml-[1px] bg-ink transition-[left] duration-300 ease-out"
            style={{ left: `${Math.min(100, Math.max(0, energy * 100))}%` }}
          />
        </div>

        {/* Gauge Axis Ticks */}
        <div className="flex justify-between items-center text-[9px] font-mono text-ink-mid px-0.5">
          <span>0.0 frozen</span>
          <span className="text-center">0.5 natural</span>
          <span className="text-right">1.0 overdoing</span>
        </div>
      </div>

      {/* Short Live SVG Sparkline Trace */}
      <div className="space-y-1 pt-1">
        <div className="flex justify-between items-center text-[9px] font-mono text-ink-mid">
          <span>Trace (recent)</span>
          <span>{trace.length}s window</span>
        </div>
        <div className="w-full bg-paper-well border border-hairline p-1">
          <svg 
            viewBox={`0 0 ${svgW} ${svgH}`} 
            className="w-full h-9 overflow-visible"
            preserveAspectRatio="none"
            aria-label="Hand energy trace"
          >
            {/* Comfortable middle band (y: 10 to 30) */}
            <rect 
              x="0" 
              y={svgH * 0.25} 
              width={svgW} 
              height={svgH * 0.5} 
              fill="currentColor" 
              className="text-ink/[0.04]" 
            />

            {/* 0.5 Midline guide */}
            <line 
              x1="0" 
              y1={svgH * 0.5} 
              x2={svgW} 
              y2={svgH * 0.5} 
              stroke="currentColor" 
              strokeDasharray="2 3" 
              strokeWidth="0.75" 
              className="text-hairline" 
            />

            {/* Upper & lower boundaries of natural band */}
            <line 
              x1="0" 
              y1={svgH * 0.25} 
              x2={svgW} 
              y2={svgH * 0.25} 
              stroke="currentColor" 
              strokeWidth="0.5" 
              className="text-hairline" 
            />
            <line 
              x1="0" 
              y1={svgH * 0.75} 
              x2={svgW} 
              y2={svgH * 0.75} 
              stroke="currentColor" 
              strokeWidth="0.5" 
              className="text-hairline" 
            />

            {/* Sparkline trace */}
            <polyline 
              points={pointsStr} 
              fill="none" 
              stroke="currentColor" 
              strokeWidth="1.5" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              className="text-ink" 
            />

            {/* Live head dot */}
            <circle 
              cx={latestX} 
              cy={latestY} 
              r="2.5" 
              fill="currentColor" 
              className="text-ink" 
            />
          </svg>
        </div>
      </div>

      {/* Motion State selector / readout */}
      <div className="pt-1">
        <div className="text-[9px] font-mono tracking-widest text-ink-mid uppercase mb-1.5">
          Motion State
        </div>
        <div className="grid grid-cols-3 gap-1 text-[11px] font-mono text-center">
          <div 
            className={`py-1 px-1.5 border transition-colors ${
              motionState === 'still'
                ? 'border-p-still text-p-still bg-p-still/10 font-medium'
                : 'border-hairline text-ink-mid/60'
            }`}
          >
            still
          </div>
          <div 
            className={`py-1 px-1.5 border transition-colors ${
              motionState === 'gesture'
                ? 'border-ink text-ink bg-ink/10 font-medium'
                : 'border-hairline text-ink-mid/60'
            }`}
          >
            gesture
          </div>
          <div 
            className={`py-1 px-1.5 border transition-colors ${
              motionState === 'fidget'
                ? 'border-p-interrupt text-p-interrupt bg-p-interrupt/10 font-medium'
                : 'border-hairline text-ink-mid/60'
            }`}
          >
            fidget
          </div>
        </div>
      </div>
    </div>
  );
}
