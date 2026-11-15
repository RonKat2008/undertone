'use client';

import { Avatar, EmptyState, KindChip, List, ListRow, Panel, Prose } from '@/components/ui';
import {
  dayWords, minutesWords, plural, relationshipWord, type ByPersonReport, type PersonReport,
  type PersonReportSummary, type RelationshipKind, type ReportPromise,
} from '@/lib/api/reports-model';
import type { RelationshipState } from '@/lib/api/reports';
import { PromiseList } from './promise-list';
import { RelationshipPicker } from './relationship-picker';
import { BackButton, Block, capital, CoachSentence, ConversationRows } from './shared';

/** The relationship to show: the change the person just made, or what the report says. */
export type RelationshipOverride = (personId: string) => RelationshipState | undefined;

function relOf(p: PersonReportSummary, override: RelationshipOverride): RelationshipState {
  return override(p.person_id) ?? { kind: p.relationship ?? 'unknown', confidence: p.relationship_confidence, source: p.relationship_source };
}

export interface PeopleListProps {
  data: ByPersonReport;
  days: number;
  now: number;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  relationship: RelationshipOverride;
}

export function PeopleList({ data, days, now, selectedId, onSelect, relationship }: PeopleListProps) {
  if (data.people.length === 0) {
    return <EmptyState>{`Nobody was named in your conversations in the last ${days} days. When Undertone knows who you were talking with, they'll be listed here.`}</EmptyState>;
  }
  return (
    <div className="grid gap-3">
      <Panel padding="list">
        <List label="People you talked with">
          {data.people.map((p) => {
            const r = relOf(p, relationship);
            const word = relationshipWord(r.kind, r.confidence, r.source);
            const facts = [word, plural(p.conversations, 'conversation'), p.last_talked ? `last ${dayWords(p.last_talked, now)}` : null].filter(Boolean).join(' · ');
            return (
              <ListRow key={p.node_id} wrap current={selectedId === p.node_id} onSelect={() => onSelect(p.node_id)}
                leading={<Avatar name={p.name} />} title={p.name}
                meta={(
                  <>
                    <span className="block">{facts}</span>
                    {p.sentence ? <span className="mt-1 block font-[family-name:var(--font-voice)] text-[15px] leading-[22px] text-fg/85">{p.sentence}</span> : null}
                  </>
                )} />
            );
          })}
        </List>
      </Panel>
      {data.untagged_conversations > 0 ? (
        <p className="px-1 text-caption text-muted">
          {capital(plural(data.untagged_conversations, 'conversation'))} had nobody named, so {data.untagged_conversations === 1 ? 'it is' : 'they are'} not counted here.
        </p>
      ) : null}
    </div>
  );
}

export interface PersonDetailProps {
  data: PersonReport;
  now: number;
  onBack: () => void;
  onOpen: (nodeId: string) => void;
  relationship: RelationshipOverride;
  relationshipBusy: boolean;
  onRelationship: (personId: string, kind: Exclude<RelationshipKind, 'unknown'> | null) => void;
  isOpen: (p: ReportPromise) => boolean;
  onTogglePromise: (p: ReportPromise) => void;
}

/** One person: how you are with them, what you share, what you owe them, and your conversations. */
export function PersonDetail({ data, now, onBack, onOpen, relationship, relationshipBusy, onRelationship, isOpen, onTogglePromise }: PersonDetailProps) {
  const p = data.person;
  const r = relOf(p, relationship);
  const open = data.promises.filter(isOpen);
  return (
    <div className="grid gap-4">
      <BackButton label="All people" onClick={onBack} />
      <Panel as="article" className="grid gap-6">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Avatar name={p.name} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="text-title font-medium">{p.name}</h2>
            <p className="text-caption text-muted">
              {p.conversations === 0
                ? 'No conversations together in this range'
                : `${capital(plural(p.conversations, 'conversation'))}, ${minutesWords(p.minutes_together)} together${p.last_talked ? `, last ${dayWords(p.last_talked, now)}` : ''}`}
            </p>
          </div>
          <RelationshipPicker name={p.name} kind={r.kind} confidence={r.confidence} source={r.source} busy={relationshipBusy}
            onPick={(k) => onRelationship(p.person_id, k)} onAuto={() => onRelationship(p.person_id, null)} />
        </header>

        {p.sentence ? <CoachSentence text={p.sentence} size="lead" /> : p.conversations > 0 ? (
          <Prose as="p" className="text-muted">You speak with {p.name} much as you do with everyone else.</Prose>
        ) : null}

        {data.topics.length > 0 ? (
          <Block title="What you talk about">
            <div className="flex flex-wrap gap-2">
              {data.topics.slice(0, 8).map((t) => (
                <button key={t.node_id} type="button" className="qi-chip cursor-pointer border-0 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  data-kind="topic" onClick={() => onOpen(t.node_id)}>
                  {t.label}
                </button>
              ))}
            </div>
          </Block>
        ) : null}

        {data.habits.length > 0 ? (
          <Block title="What showed up most">
            <div className="flex flex-wrap gap-2">
              {data.habits.slice(0, 4).map((h) => <KindChip key={h.node_id} kind="habit">{h.label}</KindChip>)}
            </div>
          </Block>
        ) : null}

        {data.promises.length > 0 ? (
          <Block title={open.length > 0 ? `What you promised ${p.name}` : `You kept every promise to ${p.name}`}>
            <PromiseList items={data.promises} now={now} isOpen={isOpen} onToggle={onTogglePromise} showPerson={false} label={`Promises to ${p.name}`} />
          </Block>
        ) : null}

        {data.timeline.length > 0 ? (
          <Block title="Your conversations">
            <div className="-mx-3"><ConversationRows items={data.timeline} now={now} label={`Conversations with ${p.name}`} /></div>
          </Block>
        ) : null}
      </Panel>
    </div>
  );
}
