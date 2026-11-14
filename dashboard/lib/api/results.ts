/**
 * Pure result handling for the REST client: shape checks at the API boundary and how each
 * answer becomes "real data", "nothing yet" or "failed, and why". No fetch, no React;
 * tested in results.test.ts.
 */
import type { HabitProfile, Person, SessionSummary, WeeklyReport } from '../bus/contracts';
import { computeStats, isKnowledgeGraph } from '../graph/model.ts';
import type { KnowledgeGraph } from '../graph/types';
import type { DebriefPayload } from './types';

/** A read: real data, or why there is none. Emptiness is real data; the screen decides how to show it. */
export type Fetched<T> = { ok: true; data: T } | { ok: false; error: string };

export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
export const errorMessage = (e: unknown, fallback: string): string => (e instanceof Error && e.message ? e.message : fallback);

export function unreachableMessage(base: string): string {
  return `Cannot reach the backend at ${base}`;
}

export function unreadableMessage(base: string, path: string): string {
  return `The backend at ${base} answered ${path.split('?')[0]} with something this screen could not read.`;
}

/** The message for a non-2xx answer: the backend's own words when it gave any. */
export function httpErrorMessage(base: string, path: string, status: number, body: unknown): string {
  const b = isObj(body) ? body : {};
  const said = isObj(b.error) && typeof b.error.message === 'string' ? b.error.message : typeof b.detail === 'string' ? b.detail : `HTTP ${status}`;
  return `The backend at ${base} answered ${path.split('?')[0]} with: ${said}`;
}

/** Validate a body that already arrived. */
export function checked<T>(body: unknown, valid: (v: unknown) => v is T, base: string, path: string): Fetched<T> {
  return valid(body) ? { ok: true, data: body } : { ok: false, error: unreadableMessage(base, path) };
}

// ---------- shape checks ----------
export const isArrayOf = <T,>(item: (v: unknown) => boolean) => (v: unknown): v is T[] => Array.isArray(v) && v.every(item);
export const isSessionSummary = (v: unknown): v is SessionSummary => isObj(v) && typeof v.session_id === 'string' && isObj(v.numbers);
export const isSessionList = isArrayOf<SessionSummary>(isSessionSummary);
export const isPerson = (v: unknown): v is Person => isObj(v) && typeof v.person_id === 'string' && typeof v.name === 'string';
export const isPeople = isArrayOf<Person>(isPerson);
export const isProfile = (v: unknown): v is HabitProfile =>
  isObj(v) && typeof v.sessions === 'number' && Array.isArray(v.crutch_words) && Array.isArray(v.recurring_issues);
export const isWeekly = (v: unknown): v is WeeklyReport => isObj(v) && Array.isArray(v.trend);
export const isDebriefPayload = (v: unknown): v is DebriefPayload =>
  isObj(v) && typeof v.session_id === 'string' && isObj(v.data) && typeof v.data.headline_fact === 'string';

// ---------- knowledge graph ----------
/**
 * Where a graph on screen came from. Only 'live' carries nodes. 'empty' is a backend with nothing
 * recorded, including its own built-in illustration (`sample: true`), which is never drawn.
 */
export type GraphSource = 'live' | 'empty' | 'unreachable' | 'invalid';

export interface GraphResult {
  data: KnowledgeGraph;
  source: GraphSource;
  error: string | null;
  /** The window this graph was loaded with; node detail must ask for the same one. */
  days: number;
}

export function emptyGraph(generated_at: number = Date.now() / 1000): KnowledgeGraph {
  return { nodes: [], edges: [], stats: computeStats([]), generated_at, sample: false };
}

/** A /graph answer as the screen shows it. */
export function toGraphResult(body: unknown, days: number, base: string, path: string): GraphResult {
  if (!isKnowledgeGraph(body)) return { data: emptyGraph(), source: 'invalid', error: unreadableMessage(base, path), days };
  if (body.sample) return { data: emptyGraph(body.generated_at), source: 'empty', error: null, days };
  return { data: body, source: 'live', error: null, days };
}

export function graphFailure(e: unknown, days: number, base: string): GraphResult {
  return { data: emptyGraph(), source: 'unreachable', error: errorMessage(e, unreachableMessage(base)), days };
}

// ---------- one-record reads (debrief, transcript) ----------
export type RecordResult<T> = { kind: 'ok'; data: T } | { kind: 'not_found' } | { kind: 'error'; message: string };

/** A failed one-record read: 404 means "there is none", anything else is an error to show. */
export function recordFailure<T>(e: unknown, base: string): RecordResult<T> {
  if (e instanceof ApiError && e.status === 404) return { kind: 'not_found' };
  return { kind: 'error', message: errorMessage(e, unreachableMessage(base)) };
}
