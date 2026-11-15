'use client';

/** The people you talk with, and what you talk about: each links into Insights. Hidden when empty. */
import Link from 'next/link';
import type { CSSProperties } from 'react';
import { Avatar, KIND_ICON, Panel, TextLink, ICON } from '@/components/ui';
import type { HomePerson, Ranked } from '@/lib/api/home-model';
import { Reveal, Stagger, StaggerItem } from './reveal';

const MAX_PEOPLE = 6;
const insightsFor = (nodeId: string) => `/insights?node=${encodeURIComponent(nodeId)}`;
const capitalise = (s: string) => s.replace(/^\w/, (c) => c.toUpperCase());

function People({ people }: { people: HomePerson[] }) {
  return (
    <Panel className="grid h-full content-start gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[17px] font-medium leading-[26px]">Your people</h3>
        <TextLink href="/insights" tone="muted">See all</TextLink>
      </div>
      <Stagger className="grid grid-cols-2 gap-1 sm:grid-cols-3">
        {people.slice(0, MAX_PEOPLE).map((p) => (
          <StaggerItem key={p.personId}>
            <Link href={insightsFor(`person:${p.personId}`)} className={`home-person home-big-avatar`}>
              <Avatar name={p.name} size="lg" />
              <span className="grid">
                <span className="font-medium">{p.name}</span>
                <span className="text-[13px] leading-[18px] text-muted">
                  {p.relationship ? capitalise(p.relationship) : `${p.conversations} ${p.conversations === 1 ? 'conversation' : 'conversations'}`}
                </span>
              </span>
              {p.hint ? <span className={`home-person-hint line-clamp-2`}>{p.hint}</span> : null}
            </Link>
          </StaggerItem>
        ))}
      </Stagger>
    </Panel>
  );
}

function Topics({ topics }: { topics: Ranked[] }) {
  const Icon = KIND_ICON.topic;
  const max = Math.max(...topics.map((t) => t.minutes), 1);
  return (
    <Panel className="grid h-full content-start gap-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[17px] font-medium leading-[26px]">What you talk about</h3>
        <TextLink href="/insights?kinds=topic" tone="muted">See all</TextLink>
      </div>
      <Stagger className={`home-chip-cloud flex flex-wrap items-center gap-2.5`}>
        {topics.map((t) => {
          const weight = t.minutes / max; // 0..1, the biggest topic is the largest chip
          const size = 13 + Math.round(weight * 5);
          return (
            <StaggerItem key={t.nodeId}>
              <Link href={insightsFor(t.nodeId)} className="qi-chip" data-kind="topic"
                style={{ fontSize: size, lineHeight: `${size + 8}px`, padding: `${4 + weight * 4}px ${10 + weight * 6}px`, minHeight: 32 } as CSSProperties}>
                <Icon {...ICON} size={Math.max(13, size - 2)} aria-hidden />
                {capitalise(t.label)}
              </Link>
            </StaggerItem>
          );
        })}
      </Stagger>
      <p className="text-[13px] leading-[18px] text-muted">Bigger means you spent longer on it this week.</p>
    </Panel>
  );
}

export function PeopleTopics({ people, topics }: { people: HomePerson[]; topics: Ranked[] }) {
  if (people.length === 0 && topics.length === 0) return null;
  const both = people.length > 0 && topics.length > 0;
  return (
    <section aria-label="People and topics" className="relative">
      <span className="home-glow" style={{ '--glow': 'var(--kind-topic)', width: 'min(560px, 100%)', height: 320, right: 0, top: -40 } as CSSProperties} aria-hidden />
      <div className={`grid gap-4 ${both ? 'lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]' : ''}`}>
        {people.length > 0 ? <Reveal><People people={people} /></Reveal> : null}
        {topics.length > 0 ? <Reveal delay={0.1}><Topics topics={topics} /></Reveal> : null}
      </div>
    </section>
  );
}
