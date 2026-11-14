'use client';

import React from 'react';

interface OneThingToFixProps {
  oneFix: string;
  ifThen: string;
}

export function OneThingToFix({ oneFix, ifThen }: OneThingToFixProps) {
  return (
    <section className="my-12 py-10 border-t-2 border-b-2 border-ink bg-paper-well/60 px-6 sm:px-10 -mx-4 sm:-mx-8 md:-mx-10">
      <div className="max-w-4xl space-y-8">
        {/* Header label */}
        <div className="flex items-center gap-3">
          <span className="w-2.5 h-2.5 bg-ink inline-block" aria-hidden="true" />
          <span className="font-mono text-xs uppercase tracking-widest text-ink font-bold">
            One Thing to Fix — Primary Focus
          </span>
        </div>

        {/* The One Fix: described as behavior, extreme scale */}
        <div className="space-y-2">
          <h2 className="font-sans text-3xl sm:text-4xl md:text-5xl font-semibold text-ink tracking-tight leading-[1.15]">
            {oneFix}
          </h2>
          <p className="font-sans text-xs uppercase tracking-wider text-ink-mid">
            Targeted single behavior for immediate improvement
          </p>
        </div>

        {/* The If-Then plan set like a line to memorise */}
        <div className="pt-6 border-t border-hairline/80 space-y-3">
          <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-widest text-ink-mid">
            <span>Memorise this cue and response</span>
            <span className="tabular-nums">If [cue] → Then [action]</span>
          </div>

          <div className="relative pl-6 py-2 border-l-4 border-ink">
            <blockquote className="font-serif italic text-2xl sm:text-3xl md:text-4xl text-ink leading-snug">
              &ldquo;{ifThen}&rdquo;
            </blockquote>
          </div>
        </div>
      </div>
    </section>
  );
}
