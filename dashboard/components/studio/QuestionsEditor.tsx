'use client';

import React, { useState } from 'react';
import type { CoachQuestion } from '@/lib/bus/contracts';

interface QuestionsEditorProps {
  questions: Record<string, CoachQuestion>;
  onChange: (questions: Record<string, CoachQuestion>) => void;
}

export function QuestionsEditor({ questions, onChange }: QuestionsEditorProps) {
  const [newKey, setNewKey] = useState('');
  const [newType, setNewType] = useState<'noul' | 'choice' | 'score'>('noul');
  const [showAddForm, setShowAddForm] = useState(false);

  const handleUpdateQuestion = (key: string, updated: CoachQuestion) => {
    onChange({
      ...questions,
      [key]: updated
    });
  };

  const handleDeleteQuestion = (key: string) => {
    const next = { ...questions };
    delete next[key];
    onChange(next);
  };

  const handleAddQuestion = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = newKey.trim().toLowerCase().replace(/\s+/g, '_');
    if (!cleanKey) return;
    if (questions[cleanKey]) {
      alert(`Question key "${cleanKey}" already exists.`);
      return;
    }

    let question: CoachQuestion;
    if (newType === 'noul') {
      question = {
        type: 'noul',
        instructions: 'Did the speaker adhere to the behavioral constraint this turn?'
      };
    } else if (newType === 'choice') {
      question = {
        type: 'choice',
        instructions: 'Classify speaker posture during this response',
        criteria: {
          focused: 'Concise and responsive',
          tangential: 'Drifting off-topic',
          defensive: 'Over-justifying past points'
        }
      };
    } else {
      question = {
        type: 'score',
        instructions: 'Evaluate turnaround quality and precision on a 1-5 scale',
        criteria: [
          '1: Unstructured and vague',
          '2: Partially addressed prompt',
          '3: Adequate clear response',
          '4: Crisp delivery with supporting evidence',
          '5: Masterful synthesis and brevity'
        ]
      };
    }

    onChange({
      ...questions,
      [cleanKey]: question
    });
    setNewKey('');
    setShowAddForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline pb-2">
        <div>
          <h4 className="font-serif text-xl text-ink">Judge Turn Inquiries</h4>
          <p className="font-sans text-xs text-ink-mid mt-0.5">
            Evaluated by the LLM judge at every conversational turn boundary.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowAddForm(!showAddForm)}
          className="text-xs font-mono uppercase tracking-wider px-3 py-1 border border-hairline hover:border-ink bg-paper hover:bg-paper-well transition-colors"
        >
          {showAddForm ? '✕ Cancel' : '+ Add Inquiry'}
        </button>
      </div>

      {showAddForm && (
        <form onSubmit={handleAddQuestion} className="p-4 border border-ink bg-paper-well space-y-3">
          <div className="font-mono text-[10px] uppercase tracking-widest text-ink-mid">
            Define New Judge Metric
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-mono text-[11px] text-ink-mid mb-1">Inquiry Key (identifier)</label>
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="e.g. monologue_discipline"
                className="w-full px-3 py-1.5 text-xs font-mono border border-hairline bg-paper text-ink focus:outline-none focus:border-ink"
              />
            </div>
            <div>
              <label className="block font-mono text-[11px] text-ink-mid mb-1">Evaluation Model</label>
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as 'noul' | 'choice' | 'score')}
                className="w-full px-3 py-1.5 text-xs font-mono border border-hairline bg-paper text-ink focus:outline-none focus:border-ink"
              >
                <option value="noul">Noul (Binary Yes / No verdict)</option>
                <option value="choice">Choice (Categorical classification)</option>
                <option value="score">Score (1..5 Tier rubric)</option>
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={!newKey.trim()}
            className="px-4 py-1.5 bg-ink text-paper text-xs font-mono uppercase tracking-wider hover:bg-ink/80 disabled:opacity-40"
          >
            Create Inquiry
          </button>
        </form>
      )}

      <div className="space-y-4">
        {Object.entries(questions).map(([key, q]) => (
          <div key={key} className="border border-hairline p-4 bg-paper hover:border-ink/40 transition-colors">
            {/* Header */}
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline pb-2 mb-3">
              <div className="flex items-center gap-3">
                <span className="font-mono font-medium text-xs text-ink">{key}</span>
                <span
                  className={`font-mono text-[10px] px-2 py-0.5 uppercase tracking-wider ${
                    q.type === 'noul'
                      ? 'bg-paper-well text-ink border border-hairline'
                      : q.type === 'choice'
                      ? 'bg-amber-100/60 text-amber-900 border border-amber-300'
                      : 'bg-blue-100/60 text-blue-900 border border-blue-300'
                  }`}
                >
                  {q.type === 'noul' ? 'noul · binary' : q.type === 'choice' ? 'choice · multi-way' : 'score · 1..5 tier'}
                </span>
              </div>
              <button
                type="button"
                onClick={() => handleDeleteQuestion(key)}
                className="font-mono text-[11px] text-ink-mid hover:text-p-interrupt transition-colors"
                title="Remove inquiry"
              >
                Remove
              </button>
            </div>

            {/* Instruction editor */}
            <div className="mb-3">
              <label className="block font-mono text-[10px] uppercase tracking-wider text-ink-mid mb-1">
                Judge Instruction Prompt
              </label>
              <textarea
                rows={2}
                value={q.instructions}
                onChange={(e) => handleUpdateQuestion(key, { ...q, instructions: e.target.value })}
                className="w-full text-xs font-sans p-2 border border-hairline bg-paper-well text-ink focus:outline-none focus:border-ink resize-y"
              />
            </div>

            {/* Type-specific Criteria display & editing */}
            {q.type === 'noul' && (
              <div className="p-2.5 bg-paper-well border border-hairline font-mono text-xs flex items-center justify-between text-ink-mid">
                <span>Output Format:</span>
                <span className="text-ink">
                  &#123; kind: &apos;noul&apos;, p: [0.0..1.0], confidence: [0.0..1.0] &#125;
                </span>
              </div>
            )}

            {q.type === 'choice' && (
              <div className="space-y-2 mt-3 pt-2 border-t border-hairline">
                <div className="font-mono text-[10px] uppercase tracking-wider text-ink-mid">
                  Classification Categories & Criteria
                </div>
                <div className="space-y-2">
                  {Object.entries(q.criteria).map(([choiceKey, description]) => (
                    <div key={choiceKey} className="flex flex-col sm:flex-row gap-2 items-start sm:items-center text-xs">
                      <span className="font-mono font-medium text-ink bg-paper-well px-2 py-1 border border-hairline shrink-0 min-w-28">
                        {choiceKey}
                      </span>
                      <input
                        type="text"
                        value={description}
                        onChange={(e) => {
                          const updated = { ...q.criteria, [choiceKey]: e.target.value };
                          handleUpdateQuestion(key, { ...q, criteria: updated });
                        }}
                        className="w-full px-2 py-1 font-sans text-xs border border-hairline bg-paper text-ink focus:outline-none focus:border-ink"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {q.type === 'score' && (
              <div className="space-y-2 mt-3 pt-2 border-t border-hairline">
                <div className="font-mono text-[10px] uppercase tracking-wider text-ink-mid">
                  Rubric Tiers (1 to {q.criteria.length})
                </div>
                <div className="space-y-1.5">
                  {q.criteria.map((levelText, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-[11px] text-ink-mid shrink-0 w-8">
                        L{idx + 1}:
                      </span>
                      <input
                        type="text"
                        value={levelText}
                        onChange={(e) => {
                          const nextCriteria = [...q.criteria];
                          nextCriteria[idx] = e.target.value;
                          handleUpdateQuestion(key, { ...q, criteria: nextCriteria });
                        }}
                        className="w-full px-2 py-1 font-sans text-xs border border-hairline bg-paper text-ink focus:outline-none focus:border-ink"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
