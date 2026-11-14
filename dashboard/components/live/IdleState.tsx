'use client';

import React from 'react';
import { useBus } from '@/lib/bus/use-bus';
import { Glyph, HapticPattern } from '@/components/Glyph';

interface RuleItem {
  id: string;
  haptic: HapticPattern;
  message: string;
  when: string;
  colorHex?: string;
  description?: string;
}

const DEFAULT_RULES: RuleItem[] = [
  {
    id: 'rule-interrupt',
    haptic: 'interrupt',
    message: 'Let them finish',
    when: 'interrupted ≥ 0.80',
    colorHex: '#E03C31',
    description: 'Triggered when you speak over their sentence.',
  },
  {
    id: 'rule-wrap-up',
    haptic: 'wrap_up',
    message: 'Ask a question',
    when: 'monologue > 45 s',
    colorHex: '#D97706',
    description: 'Triggered when monologue exceeds balanced run.',
  },
  {
    id: 'rule-filler',
    haptic: 'filler',
    message: 'Pause instead of hedging',
    when: 'fillers > 4 / min',
    colorHex: '#B48A14',
    description: 'Triggered on recurring crutch phrases ("like", "you know").',
  },
  {
    id: 'rule-slow-down',
    haptic: 'slow_down',
    message: 'Slow your pace',
    when: 'pace > 185 wpm',
    colorHex: '#2563EB',
    description: 'Triggered when pacing accelerates 25% past baseline.',
  },
  {
    id: 'rule-still',
    haptic: 'still',
    message: 'Hands calm on table',
    when: 'fidgeting ≥ 0.85',
    colorHex: '#7C3AED',
    description: 'Triggered on restless gestures or hand tension.',
  },
];

export function IdleState({ className = '' }: { className?: string } = {}) {
  const { state, startSession } = useBus();

  const coachName = state?.activeCoach?.name || 'Case Interview Coach';
  const coachGoal = state?.activeCoach?.goal || 'Sound structured, answer the question asked, stop saying like.';
  
  // Use coach's nudge rules or fallback to default rules
  const rules: RuleItem[] = (state?.activeCoach?.nudge_rules && state.activeCoach.nudge_rules.length > 0)
    ? state.activeCoach.nudge_rules.map(r => ({
        id: r.id,
        haptic: r.haptic as HapticPattern,
        message: r.message,
        when: r.when,
      }))
    : DEFAULT_RULES;

  const bandConnected = state?.bandStatus?.connected ?? true;
  const batteryPct = state?.bandStatus?.battery_pct ?? 100;
  const micOn = state?.bandStatus?.mic_on ?? true;

  return (
    <div className={`w-full max-w-5xl mx-auto px-6 py-12 lg:py-16 select-none ${className}`}>
      {/* Editorial Header */}
      <div className="border-b border-hairline pb-8 mb-10">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[11px] uppercase tracking-widest text-ink-mid">
              Standby · Ready to Score
            </span>
            <span className="text-hairline">|</span>
            <span className="font-mono text-[11px] text-ink-mid">
              Mode: <span className="text-ink font-semibold">Live Conversation</span>
            </span>
          </div>

          <div className="flex items-center gap-4 font-mono text-xs text-ink-mid">
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${bandConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              Band {bandConnected ? 'Connected' : 'Scanning'} ({batteryPct}%)
            </span>
            {micOn && (
              <span className="flex items-center gap-1.5 text-blue-600">
                <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                Mic Armed
              </span>
            )}
          </div>
        </div>

        <h1 className="font-serif text-5xl sm:text-6xl md:text-7xl text-ink font-normal tracking-tight leading-[1.05] mb-4">
          Ready to score your conversation.
        </h1>

        <p className="font-sans text-lg sm:text-xl text-ink-mid max-w-2xl leading-relaxed">
          {coachGoal}
        </p>
      </div>

      {/* Two-column layout: Band Invitation / Action + Rules Notation */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14">
        {/* Left Column: Double-tap Invitation & Start Session */}
        <div className="lg:col-span-5 flex flex-col justify-between space-y-8">
          <div className="space-y-6">
            <div className="border border-hairline bg-paper-well p-6">
              <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mid mb-2">
                Haptic Cue
              </div>
              <h2 className="font-serif text-2xl text-ink mb-2">
                Double-tap the wristband
              </h2>
              <p className="font-sans text-sm text-ink-mid leading-relaxed mb-4">
                Tap twice on the Undertone wristband to initiate the session audio feed, or press below to begin scoring directly.
              </p>
              <div className="flex items-center gap-2 font-mono text-xs text-ink-mid pt-2 border-t border-hairline">
                <Glyph pattern="tap" size="xs" color="#111827" />
                <span>Single tap anytime asks &ldquo;How am I doing?&rdquo;</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="font-mono text-[11px] uppercase tracking-wider text-ink-mid">
                Active Coach
              </div>
              <div className="font-serif text-2xl text-ink">
                {coachName}
              </div>
              <div className="font-mono text-xs text-ink-mid">
                Focus Habit: <span className="text-ink font-semibold">{rules[0]?.message}</span> · 5 buzzes budgeted
              </div>
            </div>
          </div>

          <div className="pt-4">
            <button
              onClick={startSession}
              type="button"
              className="w-full sm:w-auto border border-ink bg-ink text-paper px-8 py-3.5 font-mono text-xs uppercase tracking-widest hover:bg-transparent hover:text-ink transition-colors cursor-pointer text-center block"
            >
              Start Session Now
            </button>
            <div className="font-mono text-[11px] text-ink-mid mt-2">
              Press <kbd className="px-1 py-0.5 bg-paper-well border border-hairline text-ink">`</kbd> anytime to open the Director rehearsal panel.
            </div>
          </div>
        </div>

        {/* Right Column: Coach Rules Notation (Glyph + Message) */}
        <div className="lg:col-span-7">
          <div className="flex items-center justify-between border-b border-hairline pb-2 mb-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-mid">
              Active Coach Score Rules
            </span>
            <span className="font-mono text-[11px] text-ink-mid">
              {rules.length} Rules Active
            </span>
          </div>

          <div className="divide-y divide-hairline border-b border-hairline">
            {rules.map((rule, idx) => {
              return (
                <div 
                  key={rule.id || idx}
                  className="py-4 flex items-start gap-5 hover:bg-paper-well/30 transition-colors"
                >
                  <div className="shrink-0 pt-0.5">
                    <Glyph 
                      pattern={rule.haptic} 
                      size="md" 
                      color={rule.colorHex} 
                    />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                      <span className="font-serif text-xl sm:text-2xl text-ink">
                        {rule.message}
                      </span>
                      <span className="font-mono text-xs text-ink-mid bg-paper-well px-2 py-0.5 border border-hairline">
                        {rule.when}
                      </span>
                    </div>
                    {rule.description && (
                      <p className="font-sans text-xs text-ink-mid leading-normal">
                        {rule.description}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
