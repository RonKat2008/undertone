'use client';

/** This week in one sentence, with the real numbers rolling in. Hidden when there is nothing yet. */
import { Fragment, type CSSProperties, type ReactNode } from 'react';
import { InlineStat, Panel, Sparkline, TextLink } from '@/components/ui';
import type { Overview } from '@/lib/api/home-model';
import { Reveal } from './reveal';

/** "You had 5 conversations with 3 people. Undertone heard 69 minutes of talking, and your band nudged you 11 times." */
function Sentence({ o }: { o: Overview }) {
  const t = o.totals;
  const people = o.topPeople.length;
  const mins = t.minutesTogether !== null ? Math.round(t.minutesTogether) : 0;
  const nudges = t.nudges ?? 0;
  const second: ReactNode[] = [];
  if (mins >= 1) second.push(<>Undertone heard <InlineStat value={mins} tone="accent" /> {mins === 1 ? 'minute' : 'minutes'} of talking</>);
  if (nudges > 0) second.push(<>{second.length ? 'your' : 'Your'} band nudged you <InlineStat value={nudges} tone="coach" /> {nudges === 1 ? 'time' : 'times'}</>);
  return (
    <>
      You had <InlineStat value={t.conversations} tone="conversation" /> {t.conversations === 1 ? 'conversation' : 'conversations'}
      {people > 0 ? <> with <InlineStat value={people} tone="person" /> {people === 1 ? 'person' : 'people'}</> : null}.
      {second.length ? <> {second.map((p, i) => <Fragment key={i}>{i > 0 ? ', and ' : ''}{p}</Fragment>)}.</> : null}
    </>
  );
}

export function WeekStrip({ overview }: { overview: Overview | null }) {
  if (!overview || overview.totals.conversations === 0) return null;
  const trend = overview.perDay;
  return (
    <Reveal as="section" className="relative">
      <span className="home-glow" style={{ '--glow': 'var(--kind-conversation)', width: 'min(560px, 100%)', height: 260, right: 0, top: -60 } as CSSProperties} aria-hidden />
      <Panel className="grid gap-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="grid gap-2">
          <h2 className="text-[13px] font-medium leading-[18px] text-muted">This week</h2>
          <p className="font-voice text-[24px] leading-[32px] sm:text-[28px] sm:leading-[38px] text-pretty">
            <Sentence o={overview} />
          </p>
        </div>
        <div className="grid justify-items-start gap-2 md:justify-items-end">
          {trend.length >= 2 ? (
            <Sparkline values={trend} tone="conversation" width={160} height={40} label="Conversations each day this week" />
          ) : null}
          <TextLink href="/insights" tone="muted">See insights</TextLink>
        </div>
      </Panel>
    </Reveal>
  );
}
