'use client';

import React from 'react';
import type { CoachSpec, HabitProfile } from '@/lib/bus/contracts';

interface LibraryStripProps {
  prebuiltCoaches: CoachSpec[];
  savedCoaches: CoachSpec[];
  personalCoach: CoachSpec;
  habitProfile: HabitProfile;
  currentCoachId: string;
  activeCoachId: string | null;
  onSelectCoach: (coach: CoachSpec) => void;
  onRefreshPersonalCoach: () => void;
  isLoadingPersonal: boolean;
}

export function LibraryStrip({
  prebuiltCoaches,
  savedCoaches,
  personalCoach,
  habitProfile,
  currentCoachId,
  activeCoachId,
  onSelectCoach,
  onRefreshPersonalCoach,
  isLoadingPersonal
}: LibraryStripProps) {
  const getTrendBadge = (trend: 'better' | 'same' | 'worse') => {
    switch (trend) {
      case 'better':
        return (
          <span className="font-mono text-[10px] text-green-700 bg-green-50 px-1.5 py-0.5 border border-green-200">
            ↓ better
          </span>
        );
      case 'worse':
        return (
          <span className="font-mono text-[10px] text-red-700 bg-red-50 px-1.5 py-0.5 border border-red-200">
            ↑ worse
          </span>
        );
      case 'same':
      default:
        return (
          <span className="font-mono text-[10px] text-ink-mid bg-paper-well px-1.5 py-0.5 border border-hairline">
            → same
          </span>
        );
    }
  };

  return (
    <section className="mb-14 border-b border-hairline pb-12">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-6">
        <div>
          <span className="font-mono text-xs uppercase tracking-widest text-ink-mid">
            Coach Library & Calibration
          </span>
          <h3 className="font-serif text-2xl text-ink mt-0.5">
            Archived Profiles & Foundations
          </h3>
        </div>
        <div className="font-mono text-xs text-ink-mid">
          Active on band: <span className="text-ink font-semibold">{activeCoachId || 'None'}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Personal Coach Card with Wearer Habits & Trends (5 cols) */}
        <div className="lg:col-span-5 border border-ink bg-paper p-5 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-2 border-b border-hairline pb-3 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider bg-ink text-paper px-1.5 py-0.5">
                    Personal Habit Engine
                  </span>
                  {activeCoachId === personalCoach.id && (
                    <span className="font-mono text-[10px] text-green-700 border border-green-300 px-1.5 py-0.5">
                      ● Active
                    </span>
                  )}
                </div>
                <h4 className="font-serif text-xl text-ink mt-1.5">{personalCoach.name}</h4>
              </div>

              <button
                type="button"
                disabled={isLoadingPersonal}
                onClick={onRefreshPersonalCoach}
                className="font-mono text-[11px] text-ink-mid hover:text-ink underline disabled:opacity-50"
                title="Recalculate personal coach from past sessions"
              >
                {isLoadingPersonal ? 'Recalibrating…' : 'Recompute'}
              </button>
            </div>

            <p className="font-sans text-xs text-ink/80 leading-relaxed mb-4 italic">
              &ldquo;{personalCoach.goal}&rdquo;
            </p>

            {/* Top Crutch Words */}
            <div className="mb-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mid mb-2">
                Wearer Crutch Words ({habitProfile.sessions} sessions analyzed)
              </div>
              <div className="flex flex-wrap gap-2">
                {habitProfile.crutch_words.map((item) => (
                  <span
                    key={item.word}
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 bg-paper-well border border-hairline font-mono text-xs text-ink"
                  >
                    <span className="underline decoration-amber-500 underline-offset-2">{item.word}</span>
                    <span className="text-ink-mid text-[10px] tabular-nums">{item.per_min}/min</span>
                  </span>
                ))}
              </div>
            </div>

            {/* Recurring Issues & Trends */}
            <div className="mb-6">
              <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mid mb-2">
                Recurring Telemetry Habits & Trajectory
              </div>
              <div className="space-y-1.5">
                {habitProfile.recurring_issues.map((issue) => (
                  <div
                    key={issue.rule_id}
                    className="flex items-center justify-between text-xs py-1 border-b border-hairline/60 gap-2"
                  >
                    <span className="font-sans text-ink truncate flex-1">
                      {issue.label}
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-[11px] text-ink-mid tabular-nums">
                        {issue.rate}/sess
                      </span>
                      {getTrendBadge(issue.trend)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onSelectCoach(personalCoach)}
            className={`w-full py-2 px-4 text-xs font-mono uppercase tracking-wider transition-colors ${
              currentCoachId === personalCoach.id
                ? 'bg-paper-well border border-ink text-ink font-semibold'
                : 'bg-ink text-paper hover:bg-ink/85'
            }`}
          >
            {currentCoachId === personalCoach.id ? 'Currently Editing In Sheet' : 'Load Personal Coach Into Sheet →'}
          </button>
        </div>

        {/* Right Column: Prebuilt & Saved Coaches (7 cols) */}
        <div className="lg:col-span-7 space-y-4">
          <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mid">
            Prebuilt Foundation Specs
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {prebuiltCoaches.map((c) => {
              const isSelected = currentCoachId === c.id;
              const isActive = activeCoachId === c.id;

              return (
                <div
                  key={c.id}
                  className={`p-4 border transition-colors flex flex-col justify-between ${
                    isSelected
                      ? 'border-ink bg-paper-well/60 ring-1 ring-ink'
                      : 'border-hairline bg-paper hover:border-ink/50'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mid border border-hairline px-1.5 py-0.2">
                        Prebuilt
                      </span>
                      {isActive && (
                        <span className="font-mono text-[10px] text-green-700 bg-green-50 px-1 border border-green-300">
                          Active on band
                        </span>
                      )}
                    </div>
                    <h5 className="font-serif text-lg text-ink font-medium">{c.name}</h5>
                    <p className="font-sans text-xs text-ink-mid line-clamp-2 mt-1 italic">
                      &ldquo;{c.goal}&rdquo;
                    </p>
                    <div className="mt-3 pt-2 border-t border-hairline font-mono text-[10px] text-ink-mid space-y-0.5">
                      <div>Focus: <span className="text-ink">{c.nudge_policy.focus_rule_id}</span></div>
                      <div>Sensitivity: <span className="text-ink tabular-nums">{c.confidence_threshold.toFixed(2)}</span></div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => onSelectCoach(c)}
                    className="mt-4 w-full py-1.5 px-3 border border-hairline hover:border-ink font-mono text-xs uppercase tracking-wider text-ink bg-paper hover:bg-paper-well transition-colors"
                  >
                    {isSelected ? 'Loaded in Editor' : 'Open in Sheet →'}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Saved Custom Coaches (if any) */}
          {savedCoaches.length > 0 && (
            <div className="pt-4 border-t border-hairline">
              <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mid mb-3">
                Saved Custom Coaches ({savedCoaches.length})
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {savedCoaches.map((c) => {
                  const isSelected = currentCoachId === c.id;
                  const isActive = activeCoachId === c.id;

                  return (
                    <div
                      key={c.id}
                      className={`p-4 border transition-colors flex flex-col justify-between ${
                        isSelected
                          ? 'border-ink bg-paper-well/60 ring-1 ring-ink'
                          : 'border-hairline bg-paper hover:border-ink/50'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-mid border border-hairline px-1.5 py-0.2">
                            Saved Custom
                          </span>
                          {isActive && (
                            <span className="font-mono text-[10px] text-green-700 bg-green-50 px-1 border border-green-300">
                              Active
                            </span>
                          )}
                        </div>
                        <h5 className="font-serif text-lg text-ink font-medium">{c.name}</h5>
                        <p className="font-sans text-xs text-ink-mid line-clamp-2 mt-1 italic">
                          &ldquo;{c.goal}&rdquo;
                        </p>
                      </div>

                      <button
                        type="button"
                        onClick={() => onSelectCoach(c)}
                        className="mt-4 w-full py-1.5 px-3 border border-hairline hover:border-ink font-mono text-xs uppercase tracking-wider text-ink bg-paper hover:bg-paper-well transition-colors"
                      >
                        {isSelected ? 'Loaded in Editor' : 'Open in Sheet →'}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
