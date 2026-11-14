import type { ReactNode } from 'react';

export type StatusTone = 'neutral' | 'quiet' | 'moment' | 'warn' | 'error';

export interface StatusWordProps {
  /**
   * neutral: a plain fact ("Listening"). quiet: inactive or past ("Not listening").
   * moment: your moment, uses the accent ("Try this next"). warn: needs attention soon.
   * error: something failed. Use warn and error sparingly.
   */
  tone?: StatusTone;
  /** Announce changes to screen readers (for live state such as the band). */
  live?: boolean;
  children: ReactNode;
}

/** A state said in words. No dot, no pill, no icon; the word carries the meaning. */
export function StatusWord({ tone = 'neutral', live = false, children }: StatusWordProps) {
  return (
    <span className="qi-status" data-tone={tone} role={live ? 'status' : undefined}>
      {children}
    </span>
  );
}
