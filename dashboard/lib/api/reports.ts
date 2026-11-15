/**
 * Insights calls: the reports (GET /reports/*), relationship corrections and promise state.
 * Reads never throw: they answer data, "not found" or a failure the screen shows in plain words.
 * Writes throw so the caller can roll back an optimistic change. Shapes live in reports-model.ts.
 */
import { apiBase } from '@/lib/config';
import { ApiError, httpErrorMessage, unreachableMessage, unreadableMessage } from '@/lib/api/results';
import {
  isByPersonReport, isByTopicReport, isHabitsReport, isOverviewReport, isPersonReport, isPromisesReport, isTopicReport,
  type ByPersonReport, type ByTopicReport, type HabitsReport, type OverviewReport, type PersonReport, type PromisesReport,
  type RelationshipKind, type RelationshipSource, type TopicReport,
} from '@/lib/api/reports-model';

export type * from '@/lib/api/reports-model';

/** A read: data, nothing by that id, or a failure. `unreachable` separates "laptop off" from a bad answer. */
export type ReportResult<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'not_found' }
  | { kind: 'error'; unreachable: boolean; message: string };

async function send(path: string, init?: RequestInit): Promise<unknown> {
  const base = apiBase();
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError(unreachableMessage(base), 0);
  }
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(httpErrorMessage(base, path, res.status, body), res.status);
  return body;
}

async function read<T>(path: string, valid: (v: unknown) => v is T, signal?: AbortSignal): Promise<ReportResult<T>> {
  try {
    const body = await send(path, { signal });
    if (valid(body)) return { kind: 'ok', data: body };
    return { kind: 'error', unreachable: false, message: unreadableMessage(apiBase(), path) };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { kind: 'not_found' };
    const unreachable = e instanceof ApiError ? e.status === 0 : true;
    return { kind: 'error', unreachable, message: e instanceof Error ? e.message : unreachableMessage(apiBase()) };
  }
}

const q = (days: number) => `?days=${encodeURIComponent(String(days))}`;
const seg = (id: string) => encodeURIComponent(id);

export const getOverview = (days: number, signal?: AbortSignal) => read<OverviewReport>(`/reports/overview${q(days)}`, isOverviewReport, signal);
export const getByPerson = (days: number, signal?: AbortSignal) => read<ByPersonReport>(`/reports/by-person${q(days)}`, isByPersonReport, signal);
export const getPersonReport = (personId: string, days: number, signal?: AbortSignal) =>
  read<PersonReport>(`/reports/person/${seg(personId)}${q(days)}`, isPersonReport, signal);
export const getByTopic = (days: number, signal?: AbortSignal) => read<ByTopicReport>(`/reports/by-topic${q(days)}`, isByTopicReport, signal);
export const getTopicReport = (topicId: string, days: number, signal?: AbortSignal) =>
  read<TopicReport>(`/reports/topic/${seg(topicId)}${q(days)}`, isTopicReport, signal);
export const getHabitsReport = (days: number, signal?: AbortSignal) => read<HabitsReport>(`/reports/habits${q(days)}`, isHabitsReport, signal);
export const getPromisesReport = (days: number, signal?: AbortSignal) => read<PromisesReport>(`/reports/promises${q(days)}`, isPromisesReport, signal);

/** The parts of a Relationship answer the page shows. */
export interface RelationshipState {
  kind: RelationshipKind;
  confidence: number | null;
  source: RelationshipSource | null;
}

function toRelationship(body: unknown, path: string): RelationshipState {
  const b = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  if (!b || typeof b.kind !== 'string') throw new ApiError(unreadableMessage(apiBase(), path), 0);
  return {
    kind: b.kind as RelationshipKind,
    confidence: typeof b.confidence === 'number' ? b.confidence : null,
    source: b.source === 'user' || b.source === 'rules' || b.source === 'decisions' ? b.source : null,
  };
}

/** PUT /people/{id}/relationship: the wearer's own label. Throws on failure. */
export async function setRelationship(personId: string, kind: Exclude<RelationshipKind, 'unknown'>): Promise<RelationshipState> {
  const path = `/people/${seg(personId)}/relationship`;
  return toRelationship(await send(path, { method: 'PUT', body: JSON.stringify({ kind }) }), path);
}

/** DELETE /people/{id}/relationship: "Let Undertone decide"; answers what Undertone thinks now. Throws on failure. */
export async function clearRelationship(personId: string): Promise<RelationshipState> {
  const path = `/people/${seg(personId)}/relationship`;
  return toRelationship(await send(path, { method: 'DELETE' }), path);
}

/** POST /graph/commitment/{id}: open false = done, true = reopened. Throws on failure. */
export async function setPromiseOpen(commitmentId: string, open: boolean): Promise<void> {
  await send(`/graph/commitment/${seg(commitmentId)}`, { method: 'POST', body: JSON.stringify({ open }) });
}
