'use client';

import React, { useState } from 'react';
import type { CoachSpec } from '@/lib/bus/contracts';
import { QuestionsEditor } from './QuestionsEditor';
import { NudgeRulesTable } from './NudgeRulesTable';
import { FocusPolicyEditor } from './FocusPolicyEditor';
import { ChipsEditor } from './ChipsEditor';
import { DebriefDrillEditor } from './DebriefDrillEditor';

interface CoachSheetProps {
  coach: CoachSpec;
  isActive: boolean;
  onUpdateCoach: (coach: CoachSpec) => void;
  onActivate: () => Promise<void>;
  onSave: () => Promise<void>;
}

export function CoachSheet({
  coach,
  isActive,
  onUpdateCoach,
  onActivate,
  onSave
}: CoachSheetProps) {
  const [isActivating, setIsActivating] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleActivate = async () => {
    setIsActivating(true);
    try {
      await onActivate();
      showToast('Coach activated. Band and Live dashboard are now listening with this spec.');
    } finally {
      setIsActivating(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await onSave();
      showToast('Coach saved to your local library.');
    } finally {
      setIsSaving(false);
    }
  };

  const allRules = [...coach.nudge_rules, ...coach.motion_rules];

  return (
    <article className="border border-ink bg-paper shadow-none relative">
      {/* Toast Notification (Editorial hairline banner, not a floating bubble) */}
      {toastMessage && (
        <div className="bg-ink text-paper px-6 py-2.5 font-mono text-xs flex items-center justify-between border-b border-paper/20 animate-in fade-in">
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-paper/70 hover:text-paper font-mono text-xs ml-4"
          >
            ✕
          </button>
        </div>
      )}

      {/* Top Action Dock / Header */}
      <header className="p-6 md:p-8 border-b border-hairline bg-paper-well/50 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-ink-mid">
              Coach Specification Sheet
            </span>
            <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 bg-paper border border-hairline text-ink">
              {coach.kind}
            </span>
            {isActive && (
              <span className="font-mono text-[10px] uppercase tracking-wider px-2 py-0.5 bg-green-100 text-green-900 border border-green-300">
                ● Live Active
              </span>
            )}
          </div>
          <input
            type="text"
            value={coach.name}
            onChange={(e) => onUpdateCoach({ ...coach, name: e.target.value })}
            className="font-serif text-3xl md:text-4xl text-ink bg-transparent focus:outline-none focus:border-b focus:border-ink w-full"
            placeholder="Coach Name"
          />
        </div>

        {/* Primary Action Buttons */}
        <div className="flex items-center gap-3 shrink-0 self-start md:self-center">
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-ink hover:bg-paper-well text-ink transition-colors disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Save Coach'}
          </button>

          <button
            type="button"
            disabled={isActivating}
            onClick={handleActivate}
            className={`px-6 py-2.5 text-xs font-mono uppercase tracking-wider transition-colors shadow-none ${
              isActive
                ? 'bg-green-700 text-white hover:bg-green-800'
                : 'bg-ink text-paper hover:bg-ink/85'
            } disabled:opacity-50`}
          >
            {isActivating ? 'Activating…' : isActive ? '✓ Activated on Band' : 'Activate Coach →'}
          </button>
        </div>
      </header>

      {/* Goal Quote & Overview */}
      <section className="p-6 md:p-8 border-b border-hairline bg-paper">
        <label className="block font-mono text-[10px] uppercase tracking-widest text-ink-mid mb-2">
          Stated Goal & Behavioral Intent
        </label>
        <textarea
          rows={2}
          value={coach.goal}
          onChange={(e) => onUpdateCoach({ ...coach, goal: e.target.value })}
          className="w-full font-serif text-xl md:text-2xl italic text-ink bg-transparent border-b border-dashed border-hairline focus:border-ink focus:outline-none resize-y"
          placeholder="Conversational goal..."
        />
      </section>

      {/* Main Section Content: Hairline divided */}
      <div className="p-6 md:p-8 space-y-12">
        {/* 1. Nudge Rules & Haptic Matrix */}
        <section>
          <NudgeRulesTable
            nudgeRules={coach.nudge_rules}
            motionRules={coach.motion_rules}
            focusRuleId={coach.nudge_policy.focus_rule_id}
            onSetFocusRule={(focus_rule_id) =>
              onUpdateCoach({
                ...coach,
                nudge_policy: { ...coach.nudge_policy, focus_rule_id }
              })
            }
            onUpdateNudgeRules={(nudge_rules) => onUpdateCoach({ ...coach, nudge_rules })}
            onUpdateMotionRules={(motion_rules) => onUpdateCoach({ ...coach, motion_rules })}
          />
        </section>

        {/* 2. Focus Habit & Nudge Policy & Sensitivity */}
        <section className="border-t border-hairline pt-10">
          <FocusPolicyEditor
            policy={coach.nudge_policy}
            confidenceThreshold={coach.confidence_threshold}
            availableRules={allRules}
            onChangePolicy={(nudge_policy) => onUpdateCoach({ ...coach, nudge_policy })}
            onChangeThreshold={(confidence_threshold) => onUpdateCoach({ ...coach, confidence_threshold })}
          />
        </section>

        {/* 3. Judge Questions (noul, choice, score) */}
        <section className="border-t border-hairline pt-10">
          <QuestionsEditor
            questions={coach.questions}
            onChange={(questions) => onUpdateCoach({ ...coach, questions })}
          />
        </section>

        {/* 4. Vocabulary & Filler Lexicon */}
        <section className="border-t border-hairline pt-10">
          <ChipsEditor
            keyterms={coach.keyterms}
            fillerWords={coach.filler_words}
            onChangeKeyterms={(keyterms) => onUpdateCoach({ ...coach, keyterms })}
            onChangeFillerWords={(filler_words) => onUpdateCoach({ ...coach, filler_words })}
          />
        </section>

        {/* 5. Debrief Rubric & Practice Partner Drill */}
        <section className="border-t border-hairline pt-10">
          <DebriefDrillEditor
            debriefRubric={coach.debrief_rubric}
            drill={coach.drill}
            onChangeRubric={(debrief_rubric) => onUpdateCoach({ ...coach, debrief_rubric })}
            onChangeDrill={(drill) => onUpdateCoach({ ...coach, drill })}
          />
        </section>
      </div>

      {/* Sheet Footer with Bottom Actions */}
      <footer className="p-6 md:p-8 border-t border-hairline bg-paper-well flex flex-wrap items-center justify-between gap-4">
        <div className="font-mono text-xs text-ink-mid">
          Spec ID: <span className="text-ink">{coach.id}</span> ·{' '}
          <span className="tabular-nums">{allRules.length}</span> total rules ·{' '}
          <span className="tabular-nums">{Object.keys(coach.questions).length}</span> judge metrics
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={isSaving}
            onClick={handleSave}
            className="px-4 py-2 text-xs font-mono uppercase tracking-wider border border-hairline hover:border-ink bg-paper text-ink transition-colors"
          >
            {isSaving ? 'Saving…' : 'Save Spec'}
          </button>
          <button
            type="button"
            disabled={isActivating}
            onClick={handleActivate}
            className="px-6 py-2 text-xs font-mono uppercase tracking-wider bg-ink text-paper hover:bg-ink/85 transition-colors"
          >
            {isActivating ? 'Activating…' : isActive ? 'Active on Band' : 'Activate on Band →'}
          </button>
        </div>
      </footer>
    </article>
  );
}
