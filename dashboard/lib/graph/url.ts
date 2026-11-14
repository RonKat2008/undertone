/**
 * The graph screen's state in the URL: ?days=30&kinds=person,topic&node=person:p-sam&view=list
 * Defaults are left out so a plain "/" stays plain. Other params (?bus=…) are preserved.
 */
import type { FilterKind } from './types';

export const WINDOWS = [7, 30, 90] as const;
export type WindowDays = (typeof WINDOWS)[number];
export const DEFAULT_WINDOW: WindowDays = 30;
export type GraphView = 'graph' | 'list';

const ALL_KINDS: readonly FilterKind[] = ['person', 'topic', 'commitment', 'habit', 'conversation'];

export interface GraphUrlState {
  days: WindowDays;
  kinds: ReadonlySet<FilterKind>;
  node: string | null;
  view: GraphView;
}

export function parseGraphUrl(search: string | URLSearchParams): GraphUrlState {
  const q = typeof search === 'string' ? new URLSearchParams(search) : search;
  const daysNum = Number(q.get('days'));
  const days = (WINDOWS as readonly number[]).includes(daysNum) ? (daysNum as WindowDays) : DEFAULT_WINDOW;
  const rawKinds = q.get('kinds');
  let kinds: Set<FilterKind>;
  if (rawKinds === null) kinds = new Set(ALL_KINDS);
  else kinds = new Set(rawKinds.split(',').filter((k): k is FilterKind => (ALL_KINDS as readonly string[]).includes(k)));
  const node = q.get('node');
  return { days, kinds, node: node && node.length <= 200 ? node : null, view: q.get('view') === 'list' ? 'list' : 'graph' };
}

/** A new query string (with leading "?" or empty) for `state`, keeping unrelated params. */
export function writeGraphUrl(current: string, state: GraphUrlState): string {
  const q = new URLSearchParams(current);
  const set = (key: string, value: string | null) => (value === null ? q.delete(key) : q.set(key, value));
  set('days', state.days === DEFAULT_WINDOW ? null : String(state.days));
  const allOn = ALL_KINDS.every((k) => state.kinds.has(k));
  set('kinds', allOn ? null : ALL_KINDS.filter((k) => state.kinds.has(k)).join(','));
  set('node', state.node);
  set('view', state.view === 'graph' ? null : state.view);
  const s = q.toString();
  return s ? `?${s}` : '';
}

export function toggleKind(kinds: ReadonlySet<FilterKind>, kind: FilterKind): Set<FilterKind> {
  const next = new Set(kinds);
  if (next.has(kind)) next.delete(kind);
  else next.add(kind);
  return next;
}
