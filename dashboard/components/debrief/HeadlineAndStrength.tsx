'use client';

import React from 'react';

interface HeadlineAndStrengthProps {
  headlineFact: string;
  strength: string;
  coachName?: string;
  date?: string;
}

export function HeadlineAndStrength({
  headlineFact,
  strength,
  coachName,
  date,
}: HeadlineAndStrengthProps) {
  return (
    <section className="space-y-8 pt-4 pb-10 border-b border-hairline">
      {/* Quiet document folio / masthead metadata */}
      {(coachName || date) && (
        <div className="flex flex-wrap items-center justify-between text-xs font-mono uppercase tracking-widest text-ink-mid gap-2">
          <span>{coachName || 'Undertone Session Report'}</span>
          <span>{date || 'Closing Report'}</span>
        </div>
      )}

      {/* 1. Headline fact as a large Instrument Serif sentence */}
      <div className="space-y-2">
        <div className="font-mono text-[11px] uppercase tracking-widest text-ink-mid">
          Closing Fact
        </div>
        <h1 className="font-serif text-3xl sm:text-4xl md:text-5xl lg:text-6xl text-ink leading-[1.1] tracking-tight max-w-4xl">
          {headlineFact}
        </h1>
      </div>

      {/* 2. One specific strength, stated plainly */}
      <div className="space-y-1.5 pt-2 max-w-3xl">
        <div className="font-mono text-[11px] uppercase tracking-widest text-ink-mid">
          Observed Strength
        </div>
        <p className="font-sans text-base sm:text-lg md:text-xl text-ink leading-relaxed font-normal">
          {strength}
        </p>
      </div>
    </section>
  );
}
