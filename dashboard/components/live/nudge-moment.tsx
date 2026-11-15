'use client';

import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { PatternMark } from '@/components/ui';
import type { Mark } from '@/lib/bus/reducer';
import { SPRING } from '@/lib/motion';

/** How long a nudge holds the screen, in ms. */
export const NUDGE_MOMENT_MS = 2500;

export interface NudgeMomentProps {
  /** The nudge to show, or null when none is fresh. */
  nudge: Mark | null;
}

/**
 * The moment the phone buzzes: a full-width teal band with the words, which springs in, holds
 * for about two and a half seconds and folds away. It says only what the phone said.
 */
export function NudgeMoment({ nudge }: NudgeMomentProps) {
  const reduced = useReducedMotion() ?? false;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-24 z-40 flex justify-center px-[var(--gutter)]" aria-live="assertive">
      <AnimatePresence>
        {nudge ? (
          <m.div key={nudge.id}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: -12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.98, y: -6, transition: { duration: 0.18 } }}
            transition={reduced ? { duration: 0.15 } : SPRING}
            className="w-full max-w-[var(--col-wide)] rounded-[20px] bg-accent px-6 py-6 text-on-accent shadow-[var(--shadow-float)] sm:px-10 sm:py-8">
            <p className="text-caption font-medium opacity-80">Your phone just buzzed</p>
            <div className="mt-2 flex flex-wrap items-center gap-x-6 gap-y-3">
              <p className="text-[clamp(32px,5vw,56px)] font-medium leading-[1.05] tracking-[-0.02em]">{nudge.title}</p>
              {nudge.pattern ? <PatternMark pattern={nudge.pattern} withLabel={false} size={22} playKey={nudge.id} /> : null}
            </div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
