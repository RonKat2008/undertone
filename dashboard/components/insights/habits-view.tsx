'use client';

import { Avatar, CoachNote, EmptyState, KindDot, List, ListRow, Panel, Sparkline } from '@/components/ui';
import { habitDirection, plural, type HabitReport, type HabitsReport } from '@/lib/api/reports-model';
import { BackButton, Block, capital } from './shared';

const TONE_CLASS = { good: 'text-habit', bad: 'text-coach', neutral: 'text-muted' } as const;

function DirectionWord({ h, quiet = false }: { h: HabitReport; quiet?: boolean }) {
  const d = habitDirection(h.habit.trend);
  if (!d) return quiet ? null : <span className="text-caption text-muted">too new to compare</span>;
  return <span className={`text-caption font-medium ${TONE_CLASS[d.tone]}`}>{d.word}</span>;
}

function seriesOf(h: HabitReport): number[] {
  return h.series.map((b) => b.count);
}

function factsOf(h: HabitReport): string {
  const c = h.habit;
  const buzz = c.buzzed > 0 ? `the band buzzed ${plural(c.buzzed, 'time')}` : 'no buzzes';
  return `${capital(plural(c.conversations, 'conversation'))} · ${buzz}`;
}

export interface HabitsListProps {
  data: HabitsReport;
  days: number;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
}

export function HabitsList({ data, days, selectedId, onSelect }: HabitsListProps) {
  const shown = data.habits.filter((h) => h.habit.total > 0);
  if (shown.length === 0) {
    return <EmptyState>{`No habits noticed in the last ${days} days. When the coach hears one, such as filler words or interrupting, it shows up here with how it is moving.`}</EmptyState>;
  }
  const noneComparable = shown.every((h) => habitDirection(h.habit.trend) === null);
  return (
    <div className="grid gap-3">
    {noneComparable ? (
      <p className="px-1 text-caption text-muted">
        {`There isn't enough from the ${days} days before to say which way these are moving yet. The lines show each week.`}
      </p>
    ) : null}
    <Panel padding="list">
      <List label="Habits">
        {shown.map((h) => {
          const values = seriesOf(h);
          return (
            <ListRow key={h.habit.node_id} current={selectedId === h.habit.node_id} onSelect={() => onSelect(h.habit.node_id)}
              leading={<KindDot kind="habit" />} title={h.habit.label} meta={factsOf(h)}
              trailing={(
                <span className="flex items-center gap-3">
                  {values.length >= 2 ? <Sparkline values={values} tone="habit" width={56} height={18} label={`${h.habit.label}, week by week`} /> : null}
                  <DirectionWord h={h} quiet={noneComparable} />
                </span>
              )} />
          );
        })}
      </List>
    </Panel>
    </div>
  );
}

export function HabitDetail({ habit, onBack, onOpen }: { habit: HabitReport; onBack: () => void; onOpen: (nodeId: string) => void }) {
  const c = habit.habit;
  const values = seriesOf(habit);
  return (
    <div className="grid gap-4">
      <BackButton label="All habits" onClick={onBack} />
      <Panel as="article" className="grid gap-6">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="grid size-12 place-items-center rounded-full bg-[color-mix(in_oklch,var(--kind-habit)_20%,var(--surface))]"><KindDot kind="habit" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-medium">{c.label}</h2>
            <p className="text-caption text-muted">{factsOf(habit)}</p>
          </div>
          <div className="flex items-center gap-3">
            {values.length >= 2 ? <Sparkline values={values} tone="habit" width={88} height={28} label={`${c.label}, week by week`} /> : null}
            <DirectionWord h={habit} />
          </div>
        </header>

        {habit.by_person.length > 0 ? (
          <Block title="Most with">
            <div className="flex flex-wrap gap-2">
              {habit.by_person.slice(0, 5).map((p) => (
                <button key={p.node_id} type="button" onClick={() => onOpen(p.node_id)}
                  className="qi-chip h-9 cursor-pointer gap-2 border-0 pl-1 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" data-kind="person">
                  <Avatar name={p.label} size="sm" />{p.label}
                </button>
              ))}
            </div>
          </Block>
        ) : null}

        {habit.by_topic.length > 0 ? (
          <Block title="Most when talking about">
            <div className="flex flex-wrap gap-2">
              {habit.by_topic.slice(0, 6).map((t) => (
                <button key={t.node_id} type="button" onClick={() => onOpen(t.node_id)}
                  className="qi-chip cursor-pointer border-0 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" data-kind="topic">
                  {t.label}
                </button>
              ))}
            </div>
          </Block>
        ) : null}
      </Panel>
      {habit.if_then.length > 0 ? (
        <CoachNote from="What to try">
          {habit.if_then.slice(0, 3).map((line) => <p key={line}>{line}</p>)}
        </CoachNote>
      ) : null}
    </div>
  );
}
