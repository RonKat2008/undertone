'use client';

import { Avatar, EmptyState, KindChip, KindDot, List, ListRow, Panel, Prose, Sparkline } from '@/components/ui';
import {
  dayWords, minutesWords, plural, topicDirection, type ByTopicReport, type ReportPromise, type TopicReport,
} from '@/lib/api/reports-model';
import { PromiseList } from './promise-list';
import { BackButton, Block, capital, CoachSentence, ConversationRows } from './shared';

const TOPIC_LIMIT = 40;

export interface TopicsListProps {
  data: ByTopicReport;
  days: number;
  now: number;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
}

export function TopicsList({ data, days, now, selectedId, onSelect }: TopicsListProps) {
  if (data.topics.length === 0) {
    return <EmptyState>{`No topics in the last ${days} days yet. What you talk about shows up here once Undertone has heard a conversation or two.`}</EmptyState>;
  }
  const shown = data.topics.slice(0, TOPIC_LIMIT);
  return (
    <div className="grid gap-3">
      <Panel padding="list">
        <List label="Topics">
          {shown.map((t) => {
            const move = topicDirection(t.trend, days);
            const who = t.people.slice(0, 2).map((p) => p.label).join(' and ');
            const meta = [plural(t.conversations, 'conversation'), who ? `with ${who}` : null, t.last_discussed ? `last ${dayWords(t.last_discussed, now)}` : null]
              .filter(Boolean).join(' · ');
            return (
              <ListRow key={t.node_id} wrap current={selectedId === t.node_id} onSelect={() => onSelect(t.node_id)}
                leading={<KindDot kind="topic" />} title={capital(t.label)}
                meta={(
                  <>
                    <span className="block">{meta}</span>
                    {t.sentence ? <span className="mt-1 block font-[family-name:var(--font-voice)] text-[15px] leading-[22px] text-fg/85">{t.sentence}</span> : null}
                  </>
                )}
                trailing={move ? <span className="text-caption text-muted">{move}</span> : undefined} />
            );
          })}
        </List>
      </Panel>
      {data.topics.length > TOPIC_LIMIT ? (
        <p className="px-1 text-caption text-muted">The {TOPIC_LIMIT} that came up most. Pick a shorter range to see the rest.</p>
      ) : null}
    </div>
  );
}

export interface TopicDetailProps {
  data: TopicReport;
  days: number;
  now: number;
  onBack: () => void;
  onOpen: (nodeId: string) => void;
  isOpen: (p: ReportPromise) => boolean;
  onTogglePromise: (p: ReportPromise) => void;
}

export function TopicDetail({ data, days, now, onBack, onOpen, isOpen, onTogglePromise }: TopicDetailProps) {
  const t = data.topic;
  const move = topicDirection(t.trend, days);
  const counts = data.series.map((b) => b.count);
  const hasTrend = counts.length >= 2 && counts.some((c) => c > 0);
  return (
    <div className="grid gap-4">
      <BackButton label="All topics" onClick={onBack} />
      <Panel as="article" className="grid gap-6">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="grid size-12 place-items-center rounded-full bg-[color-mix(in_oklch,var(--kind-topic)_20%,var(--surface))]" data-kind="topic">
            <KindDot kind="topic" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-medium">{capital(t.label)}</h2>
            <p className="text-caption text-muted">
              {`${capital(plural(t.conversations, 'conversation'))}, ${minutesWords(t.minutes_together)}`}
              {t.last_discussed ? `, last ${dayWords(t.last_discussed, now)}` : ''}
              {move ? `, ${move}` : ''}
            </p>
          </div>
          {hasTrend ? <Sparkline values={counts} tone="topic" width={88} height={28} label={`How often ${t.label} came up, week by week`} /> : null}
        </header>

        {t.sentence ? <CoachSentence text={t.sentence} size="lead" /> : null}

        {t.people.length > 0 ? (
          <Block title="Who you talk about it with">
            <div className="flex flex-wrap gap-2">
              {t.people.map((p) => (
                <button key={p.node_id} type="button" onClick={() => onOpen(p.node_id)}
                  className="qi-chip h-9 cursor-pointer gap-2 border-0 pl-1 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent" data-kind="person">
                  <Avatar name={p.label} size="sm" />{p.label}
                </button>
              ))}
            </div>
          </Block>
        ) : null}

        {data.quotes.length > 0 ? (
          <Block title="In your words">
            <div className="grid gap-2 border-l-2 border-topic/50 pl-4">
              {data.quotes.slice(0, 3).map((q) => <Prose key={`${q.session_id}-${q.ts}`} as="p">“{q.text}”</Prose>)}
            </div>
          </Block>
        ) : null}

        {data.habits.length > 0 ? (
          <Block title="What showed up while it did">
            <div className="flex flex-wrap gap-2">
              {data.habits.slice(0, 4).map((h) => <KindChip key={h.node_id} kind="habit">{h.label}</KindChip>)}
            </div>
          </Block>
        ) : null}

        {data.promises.length > 0 ? (
          <Block title="Promises about it">
            <PromiseList items={data.promises} now={now} isOpen={isOpen} onToggle={onTogglePromise} label={`Promises about ${t.label}`} />
          </Block>
        ) : null}

        {data.timeline.length > 0 ? (
          <Block title="Conversations">
            <div className="-mx-3"><ConversationRows items={data.timeline} now={now} label={`Conversations about ${t.label}`} /></div>
          </Block>
        ) : null}
      </Panel>
    </div>
  );
}
