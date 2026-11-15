'use client';

import { Avatar, EmptyState, InlineStat, KindDot, List, ListRow, Panel, Prose, Section, TextLink } from '@/components/ui';
import {
  minutesWords, plural, relationshipByNode, relationshipWord, type InsightsUrlState, type OverviewReport,
} from '@/lib/api/reports-model';
import { CoachSentence } from './shared';

export interface OverviewViewProps {
  data: OverviewReport;
  days: number;
  onOpen: (nodeId: string) => void;
  hrefFor: (next: Partial<InsightsUrlState>) => string;
}

/** The lead: one sentence on the period, then the report's own highlights, then who and what. */
export function OverviewView({ data, days, onOpen, hrefFor }: OverviewViewProps) {
  const { totals, promises } = data;
  if (totals.conversations === 0) {
    return (
      <EmptyState>
        {`No conversations in the last ${days} days yet. Once Undertone hears a few, who you talk to and what about will show up here.`}
      </EmptyState>
    );
  }
  const rel = relationshipByNode(data.by_relationship);
  const highlights = data.highlights.filter((h) => h.kind !== 'insufficient_data');
  const thin = data.highlights.find((h) => h.kind === 'insufficient_data');
  const peopleCount = data.top_people.length;

  return (
    <div className="grid gap-8">
      <div className="grid gap-4">
        <Prose as="p" size="lead">
          In the last {days} days you had <InlineStat value={totals.conversations} tone="accent" />{' '}
          {totals.conversations === 1 ? 'conversation' : 'conversations'}
          {peopleCount > 0 ? <> with <InlineStat value={peopleCount} tone="person" /> {peopleCount === 1 ? 'person' : 'people'}</> : null}
          {' '}and spoke for <InlineStat value={Math.round(totals.minutes_spoken)} tone="accent" suffix=" minutes" />.
        </Prose>
        {highlights.length > 0 ? (
          <Panel tone="coach" as="section" className="grid gap-3">
            <h2 className="sr-only">What stood out</h2>
            {highlights.map((h) => <CoachSentence key={h.text} text={h.text} />)}
          </Panel>
        ) : null}
        {thin ? <p className="text-caption text-muted">{thin.text}</p> : null}
      </div>

      {data.top_people.length > 0 ? (
        <Section title="Who you talk to most" aside={<TextLink tone="muted" href={hrefFor({ view: 'people', node: null })}>Everyone</TextLink>}>
          <Panel padding="list">
            <List label="People you talk to most">
              {data.top_people.map((p) => {
                const word = relationshipWord(rel.get(p.node_id));
                return (
                  <ListRow key={p.node_id} leading={<Avatar name={p.label} size="sm" />} onSelect={() => onOpen(p.node_id)}
                    title={p.label}
                    meta={[word, `${plural(p.conversations, 'conversation')}, ${minutesWords(p.minutes)} together`].filter(Boolean).join(' · ')} />
                );
              })}
            </List>
          </Panel>
        </Section>
      ) : null}

      {data.top_topics.length > 0 ? (
        <Section title="What you talk about" aside={<TextLink tone="muted" href={hrefFor({ view: 'topics', node: null })}>All topics</TextLink>}>
          <Panel padding="list">
            <List label="Topics that came up most">
              {data.top_topics.map((t) => (
                <ListRow key={t.node_id} leading={<KindDot kind="topic" />} onSelect={() => onOpen(t.node_id)}
                  title={<span className="first-letter:uppercase">{t.label}</span>} meta={plural(t.conversations, 'conversation')} />
              ))}
            </List>
          </Panel>
        </Section>
      ) : null}

      {promises.made > 0 ? (
        <p className="text-body text-muted">
          <KindDot kind="promise" />{' '}
          {promises.open > 0 ? (
            <>
              <InlineStat value={promises.open} tone="promise" /> {promises.open === 1 ? 'promise is' : 'promises are'} still open
              {promises.overdue > 0 ? <>, <InlineStat value={promises.overdue} tone="coach" /> past the day you named</> : null}.{' '}
            </>
          ) : <>You kept every promise you made. </>}
          <TextLink href={hrefFor({ view: 'promises', node: null })}>See your promises</TextLink>
        </p>
      ) : null}
    </div>
  );
}
