/** Display helpers for graph nodes. Pure; tested in format.test.ts. */
import type { GraphNode, GraphNodeKind } from './types';

export const KIND_LABEL: Record<GraphNodeKind, { one: string; many: string }> = {
  me: { one: 'You', many: 'You' },
  person: { one: 'Person', many: 'People' },
  topic: { one: 'Topic', many: 'Topics' },
  commitment: { one: 'Promise', many: 'Promises' },
  habit: { one: 'Habit', many: 'Habits' },
  conversation: { one: 'Conversation', many: 'Conversations' },
};

export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const DAY = 86400;

/** "today", "yesterday", "3 days ago", "5 weeks ago". Both arguments in unix seconds. */
export function relativeDay(ts: number | null, now: number): string {
  if (ts === null) return 'never';
  const days = Math.floor((now - ts) / DAY);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  if (days < 70) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

const META_LABELS: Record<string, string> = {
  duration_s: 'Length',
  talk_ratio: 'You talked',
  wpm: 'Pace',
  coach_id: 'Coach',
  headline: 'Headline',
  open: 'Status',
  quote: 'In your words',
  sessions: 'Conversations',
  rate: 'How often',
  trend: 'Trend',
  per_min: 'Per minute',
};

/** Keys shown elsewhere in the panel, or meaningless to a reader. */
const HIDDEN_META = new Set(['headline', 'quote', 'person_id', 'session_id']);

export interface Fact { key: string; label: string; value: string }

function humanKey(key: string): string {
  const words = key.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatFact(key: string, value: string | number | boolean | null): Fact | null {
  if (value === null || value === '' || HIDDEN_META.has(key)) return null;
  const label = META_LABELS[key] ?? humanKey(key);
  let out: string;
  if (key === 'duration_s' && typeof value === 'number') out = duration(value);
  else if ((key === 'talk_ratio' || key === 'rate') && typeof value === 'number') out = `${Math.round(value * 100)}%`;
  else if (key === 'wpm' && typeof value === 'number') out = `${Math.round(value)} wpm`;
  else if (key === 'open' && typeof value === 'boolean') out = value ? 'Open' : 'Kept';
  else if (typeof value === 'boolean') out = value ? 'Yes' : 'No';
  else if (typeof value === 'number') out = Number.isInteger(value) ? String(value) : value.toFixed(1);
  else out = value;
  return { key, label, value: out };
}

export function nodeFacts(node: GraphNode): Fact[] {
  return Object.entries(node.meta)
    .map(([k, v]) => formatFact(k, v))
    .filter((f): f is Fact => f !== null);
}

/** One-line description used by the list view and screen readers. */
export function describeNode(node: GraphNode, now: number): string {
  const kind = KIND_LABEL[node.kind].one;
  if (node.kind === 'me') return 'You, the centre of the graph';
  const seen = node.last_seen !== null ? `, last ${relativeDay(node.last_seen, now)}` : '';
  if (node.kind === 'commitment') return `${kind}, ${node.meta.open === true ? 'open' : 'kept'}${seen}`;
  return `${kind}${seen}`;
}

/** The weight shown next to a node in lists, in the unit that suits its kind. */
export function weightLabel(node: GraphNode): string {
  if (node.kind === 'conversation' && typeof node.meta.duration_s === 'number') return duration(node.meta.duration_s);
  if (node.kind === 'habit' && typeof node.meta.rate === 'number') return `${Math.round(node.meta.rate * 100)}%`;
  if (node.kind === 'person' && Number.isInteger(node.weight)) return `${node.weight}×`;
  return String(Math.round(node.weight * 10) / 10);
}
