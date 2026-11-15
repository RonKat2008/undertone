'use client';

import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { clock, type Detection, type DetectionTone } from '@/lib/api/live';
import { SPRING } from '@/lib/motion';

/** Background, dot and text per tone. Colour carries the meaning; the words say it too. */
const TONE: Record<DetectionTone, { chip: string; dot: string }> = {
  slip: { chip: 'bg-[var(--coach-wash)] text-fg', dot: 'bg-coach' },
  good: { chip: 'bg-[var(--accent-wash)] text-fg', dot: 'bg-accent' },
  buzz: { chip: 'bg-accent text-on-accent font-medium', dot: 'bg-on-accent' },
  promise: { chip: 'bg-[color-mix(in_oklch,var(--kind-promise)_var(--wash),transparent)] text-fg', dot: 'bg-promise' },
  body: { chip: 'bg-[color-mix(in_oklch,var(--kind-conversation)_var(--wash),transparent)] text-fg', dot: 'bg-conversation' },
  them: { chip: 'bg-[color-mix(in_oklch,var(--kind-person)_var(--wash),transparent)] text-fg', dot: 'bg-person' },
  signal: { chip: 'bg-[color-mix(in_oklch,var(--warn)_var(--wash),transparent)] text-fg', dot: 'bg-warn' },
};

export const TONE_LEGEND: { tone: DetectionTone; words: string }[] = [
  { tone: 'slip', words: 'Habit' },
  { tone: 'good', words: 'Good moment' },
  { tone: 'promise', words: 'Promise' },
  { tone: 'body', words: 'Hands' },
];

export interface DetectionsProps {
  items: Detection[];
}

/** Short coloured chips, newest on top, popping in as the bus reports them. */
export function Detections({ items }: DetectionsProps) {
  const reduced = useReducedMotion() ?? false;
  if (items.length === 0) {
    return <p className="text-body py-2 text-muted">As the coach notices things, they appear here: filler words, rushing, good questions, promises.</p>;
  }
  return (
    <ol aria-label="Detections, newest first" aria-live="polite" className="grid gap-2">
      <AnimatePresence initial={false}>
        {items.map((d) => (
          <m.li key={d.id} layout={!reduced}
            initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            transition={reduced ? { duration: 0.15 } : SPRING}
            className="flex items-center justify-between gap-3">
            <span className={`text-body inline-flex min-h-9 items-center gap-2 rounded-full py-1 pl-3 pr-4 ${TONE[d.tone].chip}`}>
              <span className={`size-2 shrink-0 rounded-full ${TONE[d.tone].dot}`} aria-hidden />
              {d.text}
            </span>
            <span className="text-caption tabular shrink-0 text-muted">{clock(d.ts)}</span>
          </m.li>
        ))}
      </AnimatePresence>
    </ol>
  );
}

export function DetectionLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="What the colours mean">
      {TONE_LEGEND.map((l) => (
        <li key={l.tone} className="text-caption flex items-center gap-1.5 text-muted">
          <span className={`size-2 rounded-full ${TONE[l.tone].dot}`} aria-hidden />{l.words}
        </li>
      ))}
    </ul>
  );
}
