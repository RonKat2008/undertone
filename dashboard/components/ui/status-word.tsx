import type { ReactNode } from 'react';

export type StatusTone = 'neutral' | 'quiet' | 'moment' | 'coach' | 'warn' | 'error';

export interface StatusWordProps {
  /**
   * neutral: a healthy fact ("Connected", green dot). quiet: inactive ("Not listening", ring).
   * moment: your moment ("Try this next", teal). coach: from the coach ("New debrief", amber).
   * warn: needs attention soon. error: something failed.
   */
  tone?: StatusTone;
  /** Announce changes to screen readers (live state such as the band). */
  live?: boolean;
  children: ReactNode;
}

/** A state said in words, led by a small dot in the state's colour. The word carries the meaning. */
export function StatusWord({ tone = 'neutral', live = false, children }: StatusWordProps) {
  return (
    <span className="qi-status" data-tone={tone} role={live ? 'status' : undefined}>
      {children}
    </span>
  );
}
