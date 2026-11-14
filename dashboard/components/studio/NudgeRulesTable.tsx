'use client';

import React, { useState } from 'react';
import type { NudgeRule, HapticPattern } from '@/lib/bus/contracts';
import { HapticPicker } from './HapticPicker';
import { Glyph } from '@/components/Glyph';

interface NudgeRulesTableProps {
  nudgeRules: NudgeRule[];
  motionRules: NudgeRule[];
  focusRuleId: string;
  onSetFocusRule: (ruleId: string) => void;
  onUpdateNudgeRules: (rules: NudgeRule[]) => void;
  onUpdateMotionRules: (rules: NudgeRule[]) => void;
}

export function NudgeRulesTable({
  nudgeRules,
  motionRules,
  focusRuleId,
  onSetFocusRule,
  onUpdateNudgeRules,
  onUpdateMotionRules
}: NudgeRulesTableProps) {
  const [playingRuleId, setPlayingRuleId] = useState<string | null>(null);

  const handleToggle = (ruleId: string, isMotion: boolean) => {
    if (isMotion) {
      onUpdateMotionRules(
        motionRules.map(r => r.id === ruleId ? { ...r, enabled: r.enabled === false ? true : false } : r)
      );
    } else {
      onUpdateNudgeRules(
        nudgeRules.map(r => r.id === ruleId ? { ...r, enabled: r.enabled === false ? true : false } : r)
      );
    }
  };

  const handleUpdate = (ruleId: string, updates: Partial<NudgeRule>, isMotion: boolean) => {
    if (isMotion) {
      onUpdateMotionRules(
        motionRules.map(r => r.id === ruleId ? { ...r, ...updates } : r)
      );
    } else {
      onUpdateNudgeRules(
        nudgeRules.map(r => r.id === ruleId ? { ...r, ...updates } : r)
      );
    }
  };

  const handleDelete = (ruleId: string, isMotion: boolean) => {
    if (isMotion) {
      onUpdateMotionRules(motionRules.filter(r => r.id !== ruleId));
    } else {
      onUpdateNudgeRules(nudgeRules.filter(r => r.id !== ruleId));
    }
  };

  const handleAddRule = (isMotion: boolean) => {
    const id = isMotion ? `m_${Date.now()}` : `r_${Date.now()}`;
    const newRule: NudgeRule = isMotion
      ? {
          id,
          when: 'motion.state == "fidget" && motion.hand_energy > 0.65',
          haptic: 'still',
          message: 'Anchor your hands',
          cooldown_s: 30,
          enabled: true
        }
      : {
          id,
          when: 'metrics.monologue_s > 45',
          haptic: 'wrap_up',
          message: 'Invite a question',
          cooldown_s: 60,
          enabled: true
        };

    if (isMotion) {
      onUpdateMotionRules([...motionRules, newRule]);
    } else {
      onUpdateNudgeRules([...nudgeRules, newRule]);
    }
  };

  const triggerTestPlay = (id: string) => {
    setPlayingRuleId(id);
    setTimeout(() => {
      setPlayingRuleId(null);
    }, 2200);
  };

  return (
    <div className="space-y-8">
      {/* Conversational & Speech Nudge Rules */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline pb-2 mb-4">
          <div>
            <h4 className="font-serif text-xl text-ink">Conversational Nudge Rules</h4>
            <p className="font-sans text-xs text-ink-mid mt-0.5">
              Maps live judge outputs and conversation metrics to tactile band haptics.
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleAddRule(false)}
            className="text-xs font-mono uppercase tracking-wider px-3 py-1 border border-hairline hover:border-ink bg-paper hover:bg-paper-well transition-colors"
          >
            + Add Rule
          </button>
        </div>

        <div className="space-y-3">
          {nudgeRules.map((rule) => {
            const isFocus = focusRuleId === rule.id;
            const isEnabled = rule.enabled !== false;
            const isPlaying = playingRuleId === rule.id;

            return (
              <div
                key={rule.id}
                className={`p-4 border transition-colors ${
                  isFocus
                    ? 'border-ink bg-paper-well/60'
                    : isEnabled
                    ? 'border-hairline bg-paper'
                    : 'border-hairline/60 bg-paper/50 opacity-60'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
                  {/* Left: Focus habit radio & active toggle */}
                  <div className="flex items-center gap-3 shrink-0">
                    <label
                      className="flex items-center gap-2 cursor-pointer group"
                      title="Set as Focus Habit (the one rule that buzzes this session)"
                    >
                      <input
                        type="radio"
                        name="focus_rule_id"
                        checked={isFocus}
                        onChange={() => onSetFocusRule(rule.id)}
                        className="w-4 h-4 text-ink focus:ring-ink"
                      />
                      <span className={`font-mono text-[11px] uppercase tracking-wider ${isFocus ? 'text-ink font-semibold' : 'text-ink-mid group-hover:text-ink'}`}>
                        {isFocus ? 'Focus Habit ★' : 'Track only'}
                      </span>
                    </label>

                    <button
                      type="button"
                      onClick={() => handleToggle(rule.id, false)}
                      className={`font-mono text-[10px] px-2 py-0.5 border uppercase tracking-wider ${
                        isEnabled
                          ? 'border-ink bg-ink text-paper'
                          : 'border-hairline text-ink-mid bg-paper'
                      }`}
                    >
                      {isEnabled ? 'Active' : 'Disabled'}
                    </button>
                  </div>

                  {/* Middle: Condition -> Glyph Picker -> Message */}
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                    {/* Condition */}
                    <div className="md:col-span-5">
                      <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-mid mb-1">
                        Condition (when)
                      </label>
                      <input
                        type="text"
                        value={rule.when}
                        onChange={(e) => handleUpdate(rule.id, { when: e.target.value }, false)}
                        placeholder="e.g. metrics.monologue_s > 45"
                        className="w-full px-2.5 py-1.5 font-mono text-xs border border-hairline bg-paper text-ink focus:outline-none focus:border-ink"
                      />
                    </div>

                    {/* Arrow + Haptic Picker */}
                    <div className="md:col-span-3 flex items-center gap-2">
                      <span className="font-mono text-ink-mid select-none text-xs hidden md:inline">→</span>
                      <div className="flex-1">
                        <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-mid mb-1">
                          Haptic
                        </label>
                        <HapticPicker
                          value={rule.haptic}
                          onChange={(haptic: HapticPattern) => handleUpdate(rule.id, { haptic }, false)}
                        />
                      </div>
                    </div>

                    {/* Message */}
                    <div className="md:col-span-4">
                      <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-mid mb-1">
                        Action Message
                      </label>
                      <input
                        type="text"
                        value={rule.message}
                        onChange={(e) => handleUpdate(rule.id, { message: e.target.value }, false)}
                        placeholder="Action prompt (e.g. Let them finish)"
                        className="w-full px-2.5 py-1.5 font-sans text-xs border border-hairline bg-paper text-ink focus:outline-none focus:border-ink"
                      />
                    </div>
                  </div>

                  {/* Right: Test Playback & Remove */}
                  <div className="flex items-center gap-3 shrink-0 self-end lg:self-center">
                    <button
                      type="button"
                      onClick={() => triggerTestPlay(rule.id)}
                      className="flex items-center gap-1.5 px-2.5 py-1 border border-hairline hover:border-ink bg-paper font-mono text-[11px] text-ink transition-colors"
                      title="Preview sensation"
                    >
                      <div className="w-4 h-4 flex items-center justify-center">
                        <Glyph pattern={rule.haptic} playing={isPlaying} size="xs" />
                      </div>
                      <span>{isPlaying ? 'Pulsing…' : 'Test'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(rule.id, false)}
                      className="font-mono text-xs text-ink-mid hover:text-p-interrupt transition-colors px-1"
                      title="Remove rule"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Motion & Gesture Rules */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline pb-2 mb-4">
          <div>
            <h4 className="font-serif text-xl text-ink">Body & Motion Rules</h4>
            <p className="font-sans text-xs text-ink-mid mt-0.5">
              Triggered by real-time wearable accelerometer & hand energy telemetry.
            </p>
          </div>
          <button
            type="button"
            onClick={() => handleAddRule(true)}
            className="text-xs font-mono uppercase tracking-wider px-3 py-1 border border-hairline hover:border-ink bg-paper hover:bg-paper-well transition-colors"
          >
            + Add Motion Rule
          </button>
        </div>

        <div className="space-y-3">
          {motionRules.map((rule) => {
            const isFocus = focusRuleId === rule.id;
            const isEnabled = rule.enabled !== false;
            const isPlaying = playingRuleId === rule.id;

            return (
              <div
                key={rule.id}
                className={`p-4 border transition-colors ${
                  isFocus
                    ? 'border-ink bg-paper-well/60'
                    : isEnabled
                    ? 'border-hairline bg-paper'
                    : 'border-hairline/60 bg-paper/50 opacity-60'
                }`}
              >
                <div className="flex flex-col lg:flex-row lg:items-center gap-4 justify-between">
                  {/* Left: Focus habit radio & active toggle */}
                  <div className="flex items-center gap-3 shrink-0">
                    <label
                      className="flex items-center gap-2 cursor-pointer group"
                      title="Set as Focus Habit"
                    >
                      <input
                        type="radio"
                        name="focus_rule_id"
                        checked={isFocus}
                        onChange={() => onSetFocusRule(rule.id)}
                        className="w-4 h-4 text-ink focus:ring-ink"
                      />
                      <span className={`font-mono text-[11px] uppercase tracking-wider ${isFocus ? 'text-ink font-semibold' : 'text-ink-mid group-hover:text-ink'}`}>
                        {isFocus ? 'Focus Habit ★' : 'Track only'}
                      </span>
                    </label>

                    <button
                      type="button"
                      onClick={() => handleToggle(rule.id, true)}
                      className={`font-mono text-[10px] px-2 py-0.5 border uppercase tracking-wider ${
                        isEnabled
                          ? 'border-ink bg-ink text-paper'
                          : 'border-hairline text-ink-mid bg-paper'
                      }`}
                    >
                      {isEnabled ? 'Active' : 'Disabled'}
                    </button>
                  </div>

                  {/* Middle: Condition -> Glyph Picker -> Message */}
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
                    <div className="md:col-span-5">
                      <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-mid mb-1">
                        Motion Condition
                      </label>
                      <input
                        type="text"
                        value={rule.when}
                        onChange={(e) => handleUpdate(rule.id, { when: e.target.value }, true)}
                        className="w-full px-2.5 py-1.5 font-mono text-xs border border-hairline bg-paper text-ink focus:outline-none focus:border-ink"
                      />
                    </div>

                    <div className="md:col-span-3 flex items-center gap-2">
                      <span className="font-mono text-ink-mid select-none text-xs hidden md:inline">→</span>
                      <div className="flex-1">
                        <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-mid mb-1">
                          Haptic
                        </label>
                        <HapticPicker
                          value={rule.haptic}
                          onChange={(haptic: HapticPattern) => handleUpdate(rule.id, { haptic }, true)}
                        />
                      </div>
                    </div>

                    <div className="md:col-span-4">
                      <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-mid mb-1">
                        Action Message
                      </label>
                      <input
                        type="text"
                        value={rule.message}
                        onChange={(e) => handleUpdate(rule.id, { message: e.target.value }, true)}
                        className="w-full px-2.5 py-1.5 font-sans text-xs border border-hairline bg-paper text-ink focus:outline-none focus:border-ink"
                      />
                    </div>
                  </div>

                  {/* Right: Test Playback & Remove */}
                  <div className="flex items-center gap-3 shrink-0 self-end lg:self-center">
                    <button
                      type="button"
                      onClick={() => triggerTestPlay(rule.id)}
                      className="flex items-center gap-1.5 px-2.5 py-1 border border-hairline hover:border-ink bg-paper font-mono text-[11px] text-ink transition-colors"
                    >
                      <div className="w-4 h-4 flex items-center justify-center">
                        <Glyph pattern={rule.haptic} playing={isPlaying} size="xs" />
                      </div>
                      <span>{isPlaying ? 'Pulsing…' : 'Test'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(rule.id, true)}
                      className="font-mono text-xs text-ink-mid hover:text-p-interrupt transition-colors px-1"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
