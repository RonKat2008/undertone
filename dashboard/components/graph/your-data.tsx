'use client';

/** "Your data": the numbers and lists around the graph, from endpoints that already exist. */
import Link from 'next/link';
import { debriefHref } from '@/components/graph/detail-panel';
import { KindSwatch } from '@/components/graph/node-shape';
import { SampleTag } from '@/components/sample-tag';
import type { Sampled } from '@/lib/api/client';
import type { HabitProfile, SessionSummary, WeeklyReport } from '@/lib/bus/contracts';
import { conversationHref, LIBRARY_HREF } from '@/lib/conversations/links';
import { duration, relativeDay } from '@/lib/graph/format';
import type { GraphNode, GraphStats } from '@/lib/graph/types';

export function StatsStrip({ stats, days, loading }: { stats: GraphStats; days: number; loading: boolean }) {
  const items: { label: string; value: string; strong?: boolean }[] = [
    { label: 'Conversations', value: String(stats.conversations) },
    { label: 'People', value: String(stats.people) },
    { label: 'Topics', value: String(stats.topics) },
    { label: 'Minutes you spoke', value: String(stats.minutes_spoken) },
    { label: 'Open promises', value: String(stats.open_commitments), strong: stats.open_commitments > 0 },
  ];
  return (
    <dl aria-label={`Last ${days} days`} aria-busy={loading}
      className={`grid grid-cols-2 gap-px border-y border-ink bg-rule sm:grid-cols-5 ${loading ? 'opacity-60' : ''} transition-opacity`}>
      {items.map((it, i) => (
        <div key={it.label} className={`bg-paper py-3 pr-2 ${i === 0 ? 'pl-0' : i % 2 === 1 ? 'pl-3 sm:pl-4' : 'pl-0 sm:pl-4'} ${i === 4 ? 'col-span-2 sm:col-span-1' : ''}`}>
          <dt className="label">{it.label}</dt>
          <dd className={`num mt-0.5 text-[clamp(30px,3.4vw,44px)] leading-none ${it.strong ? 'text-[var(--k-commitment)]' : ''}`}>{it.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SectionHead({ title, count, sample }: { title: string; count?: number; sample?: boolean }) {
  return (
    <h2 className="label flex items-center gap-2 border-b border-ink pb-2 !text-ink">
      {title}{count !== undefined && <span className="num text-ink-3">{count}</span>}<SampleTag show={sample ?? false} />
    </h2>
  );
}

export function RecentConversations({ sessions, now }: { sessions: Sampled<SessionSummary[]> | null; now: number }) {
  return (
    <section aria-label="Recent conversations">
      <SectionHead title="Recent conversations" sample={sessions?.sample} />
      {!sessions && <Skeleton rows={4} />}
      {sessions && sessions.data.length === 0 && <Empty text="No conversations yet. They appear here the moment one ends." />}
      <ul>
        {sessions?.data.slice(0, 6).map((s) => {
          const when = Date.parse(s.started_at) / 1000;
          return (
            <li key={s.session_id} className="grid grid-cols-[76px_1fr] gap-x-4 border-b border-rule py-3">
              <span className="text-[12px] leading-tight text-ink-2">
                <span className="block">{Number.isFinite(when) ? (now > 0 ? relativeDay(when, now) : s.started_at.slice(0, 10)) : '—'}</span>
                <span className="num block">{duration(s.duration_s)}</span>
                {s.mode === 'practice' && <span className="label mt-1 block">practice</span>}
              </span>
              <span className="min-w-0">
                <Link href={debriefHref(s.session_id)} className="block text-[14px] leading-snug hover:underline">{s.headline_fact}</Link>
                <span className="num mt-1 block text-[11.5px] text-ink-2">{Math.round(s.numbers.talk_ratio * 100)}% you · {Math.round(s.numbers.wpm)} wpm · {s.coach_name}</span>
                <Link href={conversationHref(s.session_id)} className="link mt-1 inline-block text-[12px]">Transcript and recording</Link>
              </span>
            </li>
          );
        })}
      </ul>
      {sessions && sessions.data.length > 0 && (
        <Link href={LIBRARY_HREF} className="link text-s mt-3 inline-block">All conversations →</Link>
      )}
    </section>
  );
}

export function OpenPromises({ nodes, sample, now, onSelect }: { nodes: GraphNode[]; sample: boolean; now: number; onSelect: (id: string) => void }) {
  const open = nodes.filter((n) => n.kind === 'commitment' && n.meta.open === true).sort((a, b) => (b.last_seen ?? 0) - (a.last_seen ?? 0));
  return (
    <section aria-label="Open promises">
      <SectionHead title="Open promises" count={open.length} sample={sample} />
      {open.length === 0 && <Empty text="Nothing you promised is still open. Promises the judge hears land here." />}
      <ul>
        {open.map((n) => (
          <li key={n.id} className="border-b border-rule">
            <button type="button" onClick={() => onSelect(n.id)} className="grid w-full grid-cols-[16px_1fr] gap-x-3 py-3 text-left hover:bg-well/60">
              <span className="pt-1"><KindSwatch kind="commitment" size={12} /></span>
              <span>
                <span className="block text-[14px] font-medium leading-snug">{n.label}</span>
                {typeof n.meta.quote === 'string' && <span className="serif mt-0.5 block text-[17px] italic leading-tight text-ink-2">“{n.meta.quote}”</span>}
                <span className="mt-1 block text-[11.5px] text-ink-3">Said {relativeDay(n.last_seen, now)}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const TREND = {
  better: { mark: '↓', text: 'easing', cls: 'text-ink' },
  same: { mark: '→', text: 'steady', cls: 'text-ink-2' },
  worse: { mark: '↑', text: 'growing', cls: 'text-ink' },
} as const;

const METRIC_LABEL: Record<string, string> = { talk_ratio: 'Talk share', interruptions: 'Interruptions', questions: 'Questions', fillers_per_min: 'Fillers / min', wpm: 'Pace, wpm' };

export function TopHabits({ profile, weekly }: { profile: Sampled<HabitProfile> | null; weekly: Sampled<WeeklyReport> | null }) {
  const issues = profile ? [...profile.data.recurring_issues].sort((a, b) => b.rate - a.rate).slice(0, 4) : [];
  const fmt = (metric: string, v: number) => (metric === 'talk_ratio' ? `${Math.round(v * 100)}%` : Number.isInteger(v) ? String(v) : v.toFixed(1));
  return (
    <section aria-label="Top habits">
      <SectionHead title="Habits" sample={profile?.sample} />
      {!profile && <Skeleton rows={3} />}
      {profile && issues.length === 0 && <Empty text="No habits yet. A habit needs three conversations." />}
      <ul>
        {issues.map((h) => {
          const t = TREND[h.trend];
          return (
            <li key={h.rule_id} className="border-b border-rule py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-baseline gap-2 text-[14px]"><KindSwatch kind="habit" size={11} />{h.label}</span>
                <span className={`num shrink-0 text-[12px] ${t.cls}`} aria-label={`${t.text}`}>{t.mark} {t.text}</span>
              </div>
              <div className="mt-2 h-1.5 w-full bg-well" aria-hidden>
                <div className="h-full origin-left bg-ink-2" style={{ transform: `scaleX(${Math.min(1, h.rate)})` }} />
              </div>
              <div className="num mt-1 text-[11.5px] text-ink-2">in {Math.round(h.rate * 100)}% of conversations</div>
            </li>
          );
        })}
      </ul>
      {profile && profile.data.crutch_words.length > 0 && (
        <p className="mt-3 text-[12.5px] text-ink-2">
          <span className="label mr-2">Crutch words</span>
          {profile.data.crutch_words.map((w) => `“${w.word}” ${w.per_min.toFixed(1)}/min`).join(' · ')}
        </p>
      )}
      {weekly && weekly.data.trend.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 border-t border-rule pt-3">
          {weekly.data.trend.slice(0, 4).map((t) => (
            <div key={t.metric}>
              <dt className="label">{METRIC_LABEL[t.metric] ?? t.metric}</dt>
              <dd className="num text-[14px]">{fmt(t.metric, t.from)} <span className="text-ink-3">→</span> {fmt(t.metric, t.to)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-3 pt-3" aria-busy>
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-9 bg-well" style={{ opacity: 1 - i * 0.18 }} />)}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="py-4 text-[13px] text-ink-3">{text}</p>;
}
