'use client';

import React from 'react';
import type { NudgePolicy, NudgeRule } from '@/lib/bus/contracts';

interface FocusPolicyEditorProps {
  policy: NudgePolicy;
  confidenceThreshold: number;
  availableRules: NudgeRule[];
  onChangePolicy: (policy: NudgePolicy) => void;
  onChangeThreshold: (threshold: number) => void;
}

export function FocusPolicyEditor({
  policy,
  confidenceThreshold,
  availableRules,
  onChangePolicy,
  onChangeThreshold
}: FocusPolicyEditorProps) {
  const selectedRule = availableRules.find(r => r.id === policy.focus_rule_id);

  return (
    <div className="space-y-6">
      <div className="border-b border-hairline pb-2">
        <h4 className="font-serif text-xl text-ink">Nudge Policy & Sensitivity</h4>
        <p className="font-sans text-xs text-ink-mid mt-0.5">
          To prevent cognitive overload, exactly one habit buzzes per conversation. All other rules are recorded silently in the debrief.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left column: Focus Habit Selection & Silent mode */}
        <div className="space-y-4">
          <div>
            <label className="block font-mono text-xs uppercase tracking-widest text-ink-mid mb-2">
              Focus Habit (Buzzing Target)
            </label>
            <select
              value={policy.focus_rule_id}
              onChange={(e) => onChangePolicy({ ...policy, focus_rule_id: e.target.value })}
              className="w-full px-3 py-2 text-xs font-mono border border-hairline bg-paper text-ink focus:outline-none focus:border-ink"
            >
              {availableRules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.message} — [{r.haptic}] ({r.when})
                </option>
              ))}
            </select>
            {selectedRule && (
              <p className="font-sans text-xs text-ink-mid mt-2 italic">
                Only &ldquo;{selectedRule.message}&rdquo; will trigger a band vibration. All other rules record quiet marks.
              </p>
            )}
          </div>

          <div className="pt-2 border-t border-hairline">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={policy.silent}
                onChange={(e) => onChangePolicy({ ...policy, silent: e.target.checked })}
                className="w-4 h-4 text-ink focus:ring-ink"
              />
              <div>
                <span className="font-mono text-xs uppercase tracking-wider text-ink block">
                  Silent Observation Mode
                </span>
                <span className="font-sans text-xs text-ink-mid">
                  Disable all haptic pulses. Track telemetry, transcript verdicts, and rubric completely silently.
                </span>
              </div>
            </label>
          </div>
        </div>

        {/* Right column: Budget, Min Gap, Tolerance & Sensitivity */}
        <div className="space-y-5">
          {/* Buzz Budget */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-mono text-xs uppercase tracking-widest text-ink-mid">
                Buzz Budget per Session
              </label>
              <span className="font-mono tabular-nums text-sm font-semibold text-ink">
                {policy.budget_per_session} {policy.budget_per_session === 1 ? 'buzz' : 'buzzes'}
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              step="1"
              value={policy.budget_per_session}
              onChange={(e) => onChangePolicy({ ...policy, budget_per_session: parseInt(e.target.value, 10) })}
              className="w-full accent-ink"
            />
            <div className="flex justify-between font-mono text-[10px] text-ink-mid">
              <span>1 (ultra-conservative)</span>
              <span>5 (standard)</span>
              <span>10 (maximum)</span>
            </div>
          </div>

          {/* Minimum Gap */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-mono text-xs uppercase tracking-widest text-ink-mid">
                Minimum Gap Between Nudges
              </label>
              <span className="font-mono tabular-nums text-sm font-semibold text-ink">
                {policy.min_gap_s}s
              </span>
            </div>
            <input
              type="range"
              min="15"
              max="180"
              step="15"
              value={policy.min_gap_s}
              onChange={(e) => onChangePolicy({ ...policy, min_gap_s: parseInt(e.target.value, 10) })}
              className="w-full accent-ink"
            />
            <div className="flex justify-between font-mono text-[10px] text-ink-mid">
              <span>15s (rapid coaching)</span>
              <span>60s (deliberate)</span>
              <span>180s (spacious)</span>
            </div>
          </div>

          {/* Baseline Tolerance */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-mono text-xs uppercase tracking-widest text-ink-mid">
                Baseline Tolerance
              </label>
              <span className="font-mono tabular-nums text-sm font-semibold text-ink">
                +{Math.round(policy.tolerance * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0.05"
              max="0.60"
              step="0.05"
              value={policy.tolerance}
              onChange={(e) => onChangePolicy({ ...policy, tolerance: parseFloat(e.target.value) })}
              className="w-full accent-ink"
            />
            <p className="font-sans text-[11px] text-ink-mid mt-0.5">
              Only nudges when behavior exceeds wearer&apos;s personal baseline by this margin.
            </p>
          </div>

          {/* Sensitivity Slider (Confidence Threshold) */}
          <div className="pt-2 border-t border-hairline">
            <div className="flex items-center justify-between mb-1">
              <label className="font-mono text-xs uppercase tracking-widest text-ink-mid">
                Judge Confidence Sensitivity
              </label>
              <span className="font-mono tabular-nums text-sm font-semibold text-ink">
                {confidenceThreshold.toFixed(2)}
              </span>
            </div>
            <input
              type="range"
              min="0.50"
              max="0.95"
              step="0.01"
              value={confidenceThreshold}
              onChange={(e) => onChangeThreshold(parseFloat(e.target.value))}
              className="w-full accent-ink"
            />
            <div className="flex justify-between font-mono text-[10px] text-ink-mid">
              <span>0.50 (more frequent)</span>
              <span>0.80 (balanced)</span>
              <span>0.95 (high certainty only)</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
