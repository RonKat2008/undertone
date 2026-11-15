'use client';

import { m, useReducedMotion } from 'motion/react';
import { useId, type KeyboardEvent } from 'react';
import { KindDot, type Kind } from '@/components/ui';
import { SPRING } from '@/lib/motion';
import type { InsightView } from '@/lib/api/reports-model';

const VIEWS: { value: InsightView; label: string; kind: Kind | null }[] = [
  { value: 'overview', label: 'Overview', kind: null },
  { value: 'people', label: 'People', kind: 'person' },
  { value: 'topics', label: 'Topics', kind: 'topic' },
  { value: 'habits', label: 'Habits', kind: 'habit' },
  { value: 'promises', label: 'Promises', kind: 'promise' },
];

/**
 * Overview / People / Topics / Habits / Promises. A segmented control (44 px targets, arrow keys
 * move between options) whose raised pill springs to the current view. Each option carries its
 * kind's dot, so the colours on the map read as a key without a legend.
 */
export function ViewSwitcher({ value, onChange }: { value: InsightView; onChange: (v: InsightView) => void }) {
  const reduced = useReducedMotion() ?? false;
  const pillId = useId();
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = VIEWS.findIndex((v) => v.value === value);
    const next = VIEWS[(i + (e.key === 'ArrowRight' ? 1 : VIEWS.length - 1)) % VIEWS.length];
    onChange(next.value);
    const el = e.currentTarget.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`);
    el?.focus();
  };
  return (
    <div role="group" aria-label="Show" onKeyDown={onKey}
      className="flex w-full gap-0.5 overflow-x-auto rounded-[14px] bg-surface-2 p-1 shadow-[inset_0_0_0_1px_var(--line)] [scrollbar-width:none] sm:w-auto sm:self-start">
      {VIEWS.map((v) => {
        const active = v.value === value;
        return (
          <button key={v.value} type="button" data-value={v.value} aria-pressed={active} tabIndex={active ? 0 : -1}
            onClick={() => onChange(v.value)}
            className="relative flex min-h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-[10px] px-2.5 text-caption font-medium text-muted outline-none transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent aria-pressed:text-fg sm:flex-none sm:px-4 [@media(hover:hover)]:hover:text-fg">
            {active ? (
              <m.span layoutId={pillId} transition={reduced ? { duration: 0 } : SPRING} aria-hidden
                className="absolute inset-0 rounded-[10px] bg-surface shadow-[0_1px_2px_oklch(0%_0_0/0.2),0_0_0_1px_var(--line)]" />
            ) : null}
            <span className="relative flex items-center gap-2">
              {v.kind ? <span className="hidden min-[420px]:inline-flex"><KindDot kind={v.kind} /></span> : null}
              {v.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
