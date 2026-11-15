'use client';

import { m, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { PatternMark } from '@/components/ui';
import type { ListenLine } from '@/lib/api/coach';
import { motionPresets } from '@/lib/motion';

export interface ListenLinesProps {
  lines: ListenLine[];
  /** Names the list for screen readers. */
  label?: string;
}

/**
 * What a coach listens for: the words the phone shows, the buzz drawn as a PatternMark, and one
 * sentence on when. Hovering or focusing a line replays its buzz.
 */
export function ListenLines({ lines, label = 'What it listens for' }: ListenLinesProps) {
  const reduced = useReducedMotion() ?? false;
  const presets = motionPresets(reduced);
  const [play, setPlay] = useState<Record<string, number>>({});
  const replay = (key: string) => setPlay((p) => ({ ...p, [key]: (p[key] ?? 0) + 1 }));
  if (lines.length === 0) {
    return <p className="text-body text-muted">This coach has no buzzes turned on. It writes everything down for your debrief.</p>;
  }
  return (
    <m.ul aria-label={label} className="grid gap-1" variants={presets.list} initial="hidden" animate="shown">
      {lines.map((l) => (
        <m.li key={l.key} variants={presets.enter}
          className="group grid grid-cols-[44px_minmax(0,1fr)] sm:grid-cols-[72px_minmax(0,1fr)] items-start gap-x-4 rounded-control px-3 py-3 -mx-3 transition-colors duration-150 hover:bg-[var(--hover)]"
          onMouseEnter={() => replay(l.key)} onFocus={() => replay(l.key)} tabIndex={-1}>
          <span aria-hidden className={`flex h-6 items-center ${l.buzzes ? 'text-accent' : 'text-coach'}`}>
            <PatternMark pattern={l.haptic} withLabel={false} size={14} playKey={play[l.key]} />
          </span>
          <span className="min-w-0">
            <span className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-lead font-medium text-fg">{l.words}</span>
              <span className={`text-caption ${l.buzzes ? 'text-accent' : 'text-muted'}`}>{l.buzzes ? 'Buzzes your phone' : 'Noted for your debrief'}</span>
            </span>
            <span className="text-body mt-0.5 block text-pretty text-muted">{l.when}</span>
          </span>
        </m.li>
      ))}
    </m.ul>
  );
}
