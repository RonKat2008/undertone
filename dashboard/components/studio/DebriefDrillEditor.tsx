'use client';

import React, { useState } from 'react';

interface DebriefDrillEditorProps {
  debriefRubric: string;
  drill: { partner_persona: string; prompts: string[] };
  onChangeRubric: (rubric: string) => void;
  onChangeDrill: (drill: { partner_persona: string; prompts: string[] }) => void;
}

export function DebriefDrillEditor({
  debriefRubric,
  drill,
  onChangeRubric,
  onChangeDrill
}: DebriefDrillEditorProps) {
  const [newPrompt, setNewPrompt] = useState('');

  const handleAddPrompt = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPrompt.trim()) return;
    onChangeDrill({
      ...drill,
      prompts: [...drill.prompts, newPrompt.trim()]
    });
    setNewPrompt('');
  };

  const handleUpdatePrompt = (index: number, val: string) => {
    const updated = [...drill.prompts];
    updated[index] = val;
    onChangeDrill({
      ...drill,
      prompts: updated
    });
  };

  const handleRemovePrompt = (index: number) => {
    onChangeDrill({
      ...drill,
      prompts: drill.prompts.filter((_, i) => i !== index)
    });
  };

  return (
    <div className="space-y-8">
      {/* Debrief Rubric */}
      <div className="space-y-3">
        <div className="border-b border-hairline pb-2">
          <h4 className="font-serif text-xl text-ink">Post-Session Debrief Rubric</h4>
          <p className="font-sans text-xs text-ink-mid mt-0.5">
            Guides the synthesis of strengths, the single actionable fix, and the if-then habit plan.
          </p>
        </div>

        <div>
          <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-mid mb-1">
            Rubric Instructions (Behavioral Focus)
          </label>
          <textarea
            rows={3}
            value={debriefRubric}
            onChange={(e) => onChangeRubric(e.target.value)}
            placeholder="Focus strictly on concrete behaviors..."
            className="w-full text-xs font-sans p-3 border border-hairline bg-paper-well text-ink focus:outline-none focus:border-ink resize-y"
          />
        </div>
      </div>

      {/* Practice Drill & Simulation Prompts */}
      <div className="space-y-4">
        <div className="border-b border-hairline pb-2">
          <h4 className="font-serif text-xl text-ink">Interactive Practice Drill</h4>
          <p className="font-sans text-xs text-ink-mid mt-0.5">
            Configures the AI practice partner used in Practice Mode simulations.
          </p>
        </div>

        <div>
          <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-mid mb-1">
            Partner Persona
          </label>
          <input
            type="text"
            value={drill.partner_persona}
            onChange={(e) => onChangeDrill({ ...drill, partner_persona: e.target.value })}
            placeholder="e.g. Skeptical Systems Architect"
            className="w-full px-3 py-1.5 font-sans text-xs border border-hairline bg-paper text-ink focus:outline-none focus:border-ink"
          />
        </div>

        <div className="space-y-2">
          <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-mid">
            Drill Opening Prompts ({drill.prompts.length})
          </label>

          <div className="space-y-2">
            {drill.prompts.map((promptText, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="font-mono text-xs text-ink-mid w-6 shrink-0">
                  0{idx + 1}.
                </span>
                <input
                  type="text"
                  value={promptText}
                  onChange={(e) => handleUpdatePrompt(idx, e.target.value)}
                  className="flex-1 px-3 py-1.5 font-serif italic text-sm border border-hairline bg-paper text-ink focus:outline-none focus:border-ink"
                />
                <button
                  type="button"
                  onClick={() => handleRemovePrompt(idx)}
                  className="font-mono text-xs text-ink-mid hover:text-p-interrupt px-2"
                  title="Remove prompt"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <form onSubmit={handleAddPrompt} className="flex gap-2 pt-2">
            <input
              type="text"
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              placeholder="Add opening challenge prompt (e.g. &quot;Why wouldn't we choose Redis?&quot;)"
              className="flex-1 px-3 py-1.5 font-serif italic text-sm border border-hairline bg-paper text-ink focus:outline-none focus:border-ink"
            />
            <button
              type="submit"
              disabled={!newPrompt.trim()}
              className="px-3 py-1.5 font-mono text-xs uppercase tracking-wider bg-ink text-paper hover:bg-ink/80 disabled:opacity-40"
            >
              + Add Prompt
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
