/** Plain words for the Conversations tab: relationship kinds, a conversation's lines, day groups, weekly trends. */
import type { RelationshipKind, SessionListItem } from '@/api/client';
import type { MetricKey } from '@/api/parse';
import { howLong, when } from '@/ui/kit';

const KIND_WORDS: Record<RelationshipKind, string | null> = {
  friend: 'Friend',
  partner: 'Partner',
  family: 'Family',
  boss: 'Manager',
  report: 'Reports to you',
  coworker: 'Coworker',
  client: 'Client',
  teacher: 'Teacher',
  student: 'Student',
  service: 'Service',
  acquaintance: 'Acquaintance',
  stranger: 'Just met',
  unknown: null,
};

export function relationshipWord(kind: RelationshipKind | undefined): string | undefined {
  return kind ? KIND_WORDS[kind] ?? undefined : undefined;
}

/** The coach's headline, or a plain fallback when there is none yet. */
export function sessionTitle(s: SessionListItem): string {
  return s.headline_fact?.trim() || 'Conversation';
}

/** "Today 14:05 · 12 min · Alex", or "... · Practice". */
export function sessionDetail(s: SessionListItem, personName?: string | null): string {
  const parts = [when(s.started_at), s.duration_s === null ? '' : howLong(s.duration_s)];
  if (s.mode === 'practice') parts.push('Practice');
  else if (personName) parts.push(personName);
  return parts.filter(Boolean).join(' · ');
}

export const DAY_GROUPS = ['Today', 'Yesterday', 'This week', 'Earlier'] as const;
export type DayGroup = (typeof DAY_GROUPS)[number];

const DAY_MS = 86400000;

function dayGroup(iso: string, now: Date): DayGroup {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return 'Earlier';
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(now) - day(d)) / DAY_MS);
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'This week';
  return 'Earlier';
}

/** Conversations grouped by day, in list order; empty groups are dropped. */
export function groupByDay(sessions: SessionListItem[], now: Date = new Date()): { label: DayGroup; items: SessionListItem[] }[] {
  return DAY_GROUPS
    .map((label) => ({ label, items: sessions.filter((s) => dayGroup(s.started_at, now) === label) }))
    .filter((g) => g.items.length > 0);
}

type Better = 'up' | 'down' | null;

const TREND: Record<MetricKey, { label: string; fmt: (v: number) => string; unit: string; up: string; down: string; better: Better }> = {
  wpm: { label: 'Pace', fmt: (v) => String(Math.round(v)), unit: ' words a minute', up: 'Faster', down: 'Slower', better: null },
  talk_ratio: { label: 'You talked', fmt: (v) => `${Math.round(v * 100)}%`, unit: ' of the time', up: 'More', down: 'Less', better: null },
  fillers_per_min: { label: 'Filler words', fmt: (v) => v.toFixed(1), unit: ' a minute', up: 'More', down: 'Fewer', better: 'down' },
  interruptions: { label: 'Interruptions', fmt: (v) => String(Math.round(v)), unit: '', up: 'More', down: 'Fewer', better: 'down' },
  questions: { label: 'Questions', fmt: (v) => String(Math.round(v)), unit: '', up: 'More', down: 'Fewer', better: 'up' },
};

export interface TrendWords {
  key: MetricKey;
  line: string;
  /** "Fewer", "Faster", "Steady". */
  word: string;
  /** better / worse / neither (pace and talk share depend on the conversation). */
  tone: 'better' | 'worse' | 'neutral';
}

/** "Pace 182 → 164 words a minute", with a direction word and whether it is an improvement. */
export function trendWords(t: { metric: MetricKey; from: number; to: number }): TrendWords | null {
  const m = TREND[t.metric];
  if (!m) return null;
  const from = m.fmt(t.from);
  const to = m.fmt(t.to);
  if (from === to) return { key: t.metric, line: `${m.label} ${to}${m.unit}`, word: 'Steady', tone: 'neutral' };
  const dir: Better = t.to > t.from ? 'up' : 'down';
  const tone = m.better === null ? 'neutral' : m.better === dir ? 'better' : 'worse';
  return { key: t.metric, line: `${m.label} ${from} → ${to}${m.unit}`, word: dir === 'up' ? m.up : m.down, tone };
}
