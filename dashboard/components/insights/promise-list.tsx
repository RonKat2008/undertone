'use client';

import { Check } from 'lucide-react';
import { m, useReducedMotion } from 'motion/react';
import { ICON } from '@/components/ui';
import { dayWords, dueWords, type ReportPromise } from '@/lib/api/reports-model';
import { capital } from './shared';

export interface PromiseListProps {
  items: ReportPromise[];
  now: number;
  /** The open state to show: the server's, or the change the person just made. */
  isOpen: (p: ReportPromise) => boolean;
  onToggle: (p: ReportPromise) => void;
  selectedId?: string | null;
  onSelect?: (p: ReportPromise) => void;
  /** Leave out "to <person>" when the context already says who. */
  showPerson?: boolean;
  label: string;
}

/** Promises as a checklist: who, what, when it is due, and a box to mark it done or reopen it. */
export function PromiseList({ items, now, isOpen, onToggle, selectedId, onSelect, showPerson = true, label }: PromiseListProps) {
  return (
    <ul className="grid" aria-label={label}>
      {items.map((p) => (
        <PromiseItem key={p.id} p={p} now={now} open={isOpen(p)} onToggle={() => onToggle(p)}
          selected={selectedId === p.id} onSelect={onSelect ? () => onSelect(p) : undefined} showPerson={showPerson} />
      ))}
    </ul>
  );
}

function PromiseItem({ p, now, open, onToggle, selected, onSelect, showPerson }: {
  p: ReportPromise; now: number; open: boolean; onToggle: () => void; selected: boolean; onSelect?: () => void; showPerson: boolean;
}) {
  const reduced = useReducedMotion() ?? false;
  const due = dueWords({ ...p, open }, now);
  const late = open && p.overdue;
  const bits = [
    showPerson && p.person_name ? `To ${p.person_name}` : null,
    `promised ${dayWords(p.made_at, now)}`,
    !open && p.closed_by === 'auto' ? 'Undertone heard you keep it' : null,
  ].filter(Boolean) as string[];
  const meta = capital(bits.join(', '));
  return (
    <li className="ins-promise relative flex items-start gap-1 rounded-[12px] px-1 py-1.5 transition-colors duration-150 [&+&]:before:absolute [&+&]:before:inset-x-3 [&+&]:before:top-0 [&+&]:before:border-t [&+&]:before:border-line data-[selected]:bg-[var(--accent-wash)]"
      data-selected={selected || undefined}>
      <button type="button" role="checkbox" aria-checked={!open} onClick={onToggle}
        aria-label={open ? `Mark done: ${p.text}` : `Reopen: ${p.text}`}
        className="group grid size-11 shrink-0 place-items-center rounded-full outline-none">
        <span className="grid size-[22px] place-items-center rounded-full border-[1.5px] border-promise transition-[background-color,transform] duration-150 ease-out group-active:scale-90 group-focus-visible:outline group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-accent"
          style={{ background: open ? 'transparent' : 'var(--kind-promise)' }}>
          {!open ? (
            <m.span initial={reduced ? false : { scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.18 }} className="grid place-items-center text-on-accent">
              <Check {...ICON} size={14} strokeWidth={2.5} aria-hidden />
            </m.span>
          ) : null}
        </span>
      </button>
      <div className="min-w-0 flex-1 py-2.5 pr-2">
        {onSelect ? (
          <button type="button" onClick={onSelect} aria-pressed={selected}
            className={`block w-full rounded-[6px] text-left text-body font-medium outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent ${open ? 'text-fg' : 'text-muted line-through decoration-line-strong'}`}>
            {p.text}
          </button>
        ) : (
          <p className={`text-body font-medium ${open ? 'text-fg' : 'text-muted line-through decoration-line-strong'}`}>{p.text}</p>
        )}
        <p className="text-caption text-muted">
          {meta}
          {due ? <>, <span className={late ? 'font-medium text-warn' : undefined}>{due}</span></> : null}
        </p>
      </div>
    </li>
  );
}
