'use client';

import React, { useState } from 'react';

interface PromptHeroProps {
  onGenerate: (goal: string) => void;
  isGenerating: boolean;
}

const EXAMPLE_GOALS = [
  'stop interrupting people when they explain technical trade-offs',
  'give concise executive summaries without rambling into edge cases',
  'ask more clarifying questions and listen before defending my proposal'
];

export function PromptHero({ onGenerate, isGenerating }: PromptHeroProps) {
  const [goal, setGoal] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim() || isGenerating) return;
    onGenerate(goal.trim());
  };

  return (
    <section className="mb-14 border-b border-hairline pb-12">
      <div className="font-mono text-xs uppercase tracking-widest text-ink-mid mb-3">
        Studio · Build a coach in one sentence
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="relative group">
          <label htmlFor="coach-prompt" className="sr-only">
            Coach goal prompt
          </label>
          <div className="flex flex-col sm:flex-row items-baseline gap-2 sm:gap-3 border-b-2 border-ink focus-within:border-ink transition-colors pb-3">
            <span className="font-serif text-3xl sm:text-4xl md:text-5xl text-ink whitespace-nowrap select-none italic">
              I want to
            </span>
            <input
              id="coach-prompt"
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="stop interrupting and deliver concise executive summaries…"
              disabled={isGenerating}
              className="w-full bg-transparent font-serif text-2xl sm:text-3xl md:text-4xl text-ink placeholder:text-ink-mid/40 focus:outline-none"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={!goal.trim() || isGenerating}
              className="self-end sm:self-auto px-5 py-2.5 bg-ink text-paper text-sm font-sans tracking-wide hover:bg-ink/85 disabled:opacity-40 disabled:hover:bg-ink transition-colors shrink-0"
            >
              {isGenerating ? 'Synthesizing…' : 'Synthesize Coach →'}
            </button>
          </div>
        </div>

        <div className="flex flex-col md:flex-row md:items-center gap-2 pt-2">
          <span className="font-mono text-[11px] text-ink-mid uppercase tracking-wider shrink-0">
            Suggested goals:
          </span>
          <div className="flex flex-wrap gap-2">
            {EXAMPLE_GOALS.map((example, idx) => (
              <button
                key={idx}
                type="button"
                disabled={isGenerating}
                onClick={() => setGoal(example)}
                className="text-left font-sans text-xs text-ink-mid hover:text-ink border-b border-dashed border-hairline hover:border-ink transition-colors py-0.5 disabled:opacity-50"
              >
                &ldquo;{example}&rdquo;
              </button>
            ))}
          </div>
        </div>
      </form>
    </section>
  );
}
