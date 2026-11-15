'use client';

import { Disclosure, EmptyState, InlineStat, Panel, Prose } from '@/components/ui';
import type { PromisesReport, ReportPromise } from '@/lib/api/reports-model';
import { PromiseList } from './promise-list';

export interface PromisesViewProps {
  data: PromisesReport;
  days: number;
  now: number;
  selectedId: string | null;
  onSelect: (p: ReportPromise) => void;
  isOpen: (p: ReportPromise) => boolean;
  onToggle: (p: ReportPromise) => void;
}

/** A checklist of what you said you would do. Ticking one marks it done; the kept ones sit behind a click. */
export function PromisesView({ data, days, now, selectedId, onSelect, isOpen, onToggle }: PromisesViewProps) {
  const all = [...data.open, ...data.done];
  if (all.length === 0) {
    return <EmptyState>{`No promises in the last ${days} days. When you tell someone you'll do something, Undertone notes it here so it doesn't slip.`}</EmptyState>;
  }
  // Keep each promise in the list it started in, so ticking one does not make it jump away.
  const open = data.open;
  const kept = data.done;
  const stillOpen = all.filter(isOpen).length;
  const overdue = all.filter((p) => isOpen(p) && p.overdue).length;
  return (
    <div className="grid gap-5">
      <Prose as="p" size="lead">
        {stillOpen === 0 ? <>You kept every promise from the last {days} days.</> : (
          <>
            You have <InlineStat value={stillOpen} tone="promise" /> {stillOpen === 1 ? 'promise' : 'promises'} still open
            {overdue > 0 ? <>, and <InlineStat value={overdue} tone="coach" /> {overdue === 1 ? 'is' : 'are'} past the day you named</> : null}.
          </>
        )}
      </Prose>
      {open.length > 0 ? (
        <Panel padding="list">
          <PromiseList items={open} now={now} isOpen={isOpen} onToggle={onToggle} selectedId={selectedId} onSelect={onSelect} label="Open promises" />
        </Panel>
      ) : null}
      {kept.length > 0 ? (
        <Disclosure summary={`Kept (${kept.length})`} defaultOpen={open.length === 0}>
          <Panel padding="list" className="mt-2">
            <PromiseList items={kept} now={now} isOpen={isOpen} onToggle={onToggle} selectedId={selectedId} onSelect={onSelect} label="Kept promises" />
          </Panel>
        </Disclosure>
      ) : null}
    </div>
  );
}
