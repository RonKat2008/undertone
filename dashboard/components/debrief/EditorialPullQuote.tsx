'use client';

import React from 'react';

interface EditorialPullQuoteProps {
  quote: string;
}

export function EditorialPullQuote({ quote }: EditorialPullQuoteProps) {
  if (!quote) return null;

  return (
    <section className="py-14 border-b border-hairline my-4">
      <div className="max-w-4xl mx-auto space-y-6 text-center sm:text-left">
        <div className="flex items-center justify-center sm:justify-start gap-2">
          <span className="w-2 h-2 bg-ink inline-block" aria-hidden="true" />
          <span className="font-mono text-[11px] uppercase tracking-widest text-ink font-semibold">
            Best-Moment Pull Quote
          </span>
        </div>

        <div className="relative pt-2">
          <blockquote className="font-serif italic text-3xl sm:text-4xl md:text-5xl text-ink leading-[1.2] tracking-tight">
            &ldquo;{quote}&rdquo;
          </blockquote>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-4 border-t border-hairline font-mono text-[11px] text-ink-mid">
          <span className="uppercase tracking-widest">
            Exemplary Moment · Clear Problem Framing
          </span>
          <span className="italic">
            Maintained composure, invited structured collaboration
          </span>
        </div>
      </div>
    </section>
  );
}
