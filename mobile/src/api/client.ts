/**
 * The phone's REST client. Live once paired (base URL + device token set by the bus provider).
 * Every read returns a `Load<T>`: the laptop's real data, or a typed reason there is none.
 * It never substitutes canned data.
 */
import type { DailyMission, Person, Streak, WeeklyReport } from '@/bus/contracts';
import {
  parseDebriefPayload, parseMission, parsePeople, parseSessions, parseStreak, parseWeekly,
  type DebriefPayload, type SessionListItem,
} from './parse';
import { parseTranscript, type SessionTranscript } from './transcript';

export type { DebriefPayload, DebriefView, SessionListItem } from './parse';
export type { SessionTranscript, TranscriptTurn } from './transcript';

/**
 *   ok           real data (a list may be empty: nothing recorded yet)
 *   none         the laptop has nothing for this yet (404, or an empty answer)
 *   not-paired   this phone has no laptop to ask
 *   error        the laptop could not be reached, refused, or sent something this app cannot read
 */
export type Load<T> =
  | { kind: 'ok'; data: T }
  | { kind: 'none' }
  | { kind: 'not-paired' }
  | { kind: 'error'; message: string; unreachable: boolean };

export interface AppInfo { app_id: string; name: string; origin: string | null; status: 'pending' | 'approved' | 'revoked'; created_at: number; last_used: number | null; buzzes: number }

let api: { url: string; token: string } | null = null;
export function setApi(next: { url: string; token: string } | null): void { api = next; }

const REQUEST_TIMEOUT_MS = 8000;
const UNREACHABLE = 'Cannot reach the laptop.';
const UNREADABLE = 'The laptop sent an answer this app cannot read.';

/** A non-2xx reply from the laptop; `status` lets a screen tell "not found" from "unreachable". */
export class HttpError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function http<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (!api) throw new Error('This phone is not paired with a laptop.');
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(api.url + path, {
      method, signal: abort.signal, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', 'X-Device-Token': api.token },
    });
  } catch {
    throw new Error(UNREACHABLE);
  } finally {
    clearTimeout(timeout);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(data?.error?.message ?? `HTTP ${res.status}`, res.status);
  return data as T;
}

/** GET and shape-check. `parse` returns null for an unreadable answer, or 'none' for "nothing yet". */
async function load<T>(path: string, parse: (v: unknown) => T | 'none' | null): Promise<Load<T>> {
  if (!api) return { kind: 'not-paired' };
  let raw: unknown;
  try {
    raw = await http<unknown>(path);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return { kind: 'none' };
    const message = e instanceof Error ? e.message : UNREACHABLE;
    return { kind: 'error', message, unreachable: !(e instanceof HttpError) };
  }
  const parsed = parse(raw);
  if (parsed === null) return { kind: 'error', message: UNREADABLE, unreachable: false };
  if (parsed === 'none') return { kind: 'none' };
  return { kind: 'ok', data: parsed };
}

/** A list that 404s is just an empty list. */
const asList = <T>(r: Load<T[]>): Load<T[]> => (r.kind === 'none' ? { kind: 'ok', data: [] } : r);

export function mediaUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:/.test(path)) return path;
  return api ? api.url + path : null;
}

export const getMissionToday = (): Promise<Load<DailyMission>> => load('/mission/today', parseMission);
export const getStreak = (): Promise<Load<Streak>> => load('/streak', parseStreak);
export const listPeople = async (): Promise<Load<Person[]>> => asList(await load('/people', parsePeople));
export const getWeeklyReport = (): Promise<Load<WeeklyReport>> => load('/report/weekly', parseWeekly);

/** GET /sessions lists only kept conversations; a row that still says `kept: false` is dropped anyway. */
export async function listSessions(): Promise<Load<SessionListItem[]>> {
  const r = asList(await load('/sessions', parseSessions));
  return r.kind === 'ok' ? { kind: 'ok', data: r.data.filter((s) => s.kept !== false) } : r;
}

/** 'none': this conversation has no debrief (a short or quiet one closes without one). */
export const getDebrief = (id: string): Promise<Load<DebriefPayload>> =>
  load(`/sessions/${encodeURIComponent(id)}/debrief`, (v) => parseDebriefPayload(v, id));

export type TranscriptResult =
  | { kind: 'ok'; data: SessionTranscript; dropped: number }
  | { kind: 'not-found' }
  | { kind: 'not-paired' }
  | { kind: 'unreachable'; message: string };

/** GET /sessions/{id}/transcript. */
export async function getTranscript(id: string): Promise<TranscriptResult> {
  if (!api) return { kind: 'not-paired' };
  let raw: unknown;
  try {
    raw = await http<unknown>(`/sessions/${encodeURIComponent(id)}/transcript`);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return { kind: 'not-found' };
    return { kind: 'unreachable', message: e instanceof Error ? e.message : UNREACHABLE };
  }
  const parsed = parseTranscript(raw);
  if (!parsed) return { kind: 'unreachable', message: 'The laptop sent a transcript this app cannot read.' };
  return { kind: 'ok', data: parsed.transcript, dropped: parsed.dropped };
}

export async function chooseMission(focus_rule_id: string): Promise<DailyMission> {
  const next = parseMission(await http<unknown>('/mission/choose', 'POST', { focus_rule_id }));
  if (!next || next === 'none') throw new Error(UNREADABLE);
  return next;
}

export const tagPerson = (session_id: string, name: string): Promise<Person> =>
  http<Person>(`/sessions/${encodeURIComponent(session_id)}/person`, 'POST', { name });

// ---------- connected apps ----------
function parseApps(v: unknown): AppInfo[] | null {
  const apps = (v as { apps?: unknown } | null)?.apps;
  if (!Array.isArray(apps)) return null;
  return apps.flatMap((a): AppInfo[] => {
    const o = a as Partial<AppInfo> | null;
    if (!o || typeof o.app_id !== 'string' || typeof o.name !== 'string') return [];
    const status = o.status === 'approved' || o.status === 'revoked' ? o.status : 'pending';
    const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
    return [{ app_id: o.app_id, name: o.name, origin: typeof o.origin === 'string' ? o.origin : null, status, created_at: n(o.created_at) ?? 0, last_used: n(o.last_used), buzzes: n(o.buzzes) ?? 0 }];
  });
}

export const listApps = async (): Promise<Load<AppInfo[]>> => asList(await load('/v1/apps', parseApps));

export async function approveApp(app_id: string): Promise<void> {
  await http(`/v1/apps/${encodeURIComponent(app_id)}/approve`, 'POST', {});
}

export async function revokeApp(app_id: string): Promise<void> {
  await http(`/v1/apps/${encodeURIComponent(app_id)}`, 'DELETE');
}

// ---------- relationships (optional route: a laptop without it answers 404, read as an empty list) ----------
export type RelationshipKind = 'friend' | 'partner' | 'family' | 'boss' | 'report' | 'coworker' | 'client' | 'teacher' | 'student' | 'service' | 'acquaintance' | 'stranger' | 'unknown';
export interface PersonRelationshipView { person_id: string; name: string; kind: RelationshipKind }

const KINDS: readonly RelationshipKind[] = ['friend', 'partner', 'family', 'boss', 'report', 'coworker', 'client', 'teacher', 'student', 'service', 'acquaintance', 'stranger', 'unknown'];

function parseRelationships(v: unknown): PersonRelationshipView[] | null {
  if (!Array.isArray(v)) return null;
  return v.flatMap((r): PersonRelationshipView[] => {
    const o = r as { person_id?: unknown; name?: unknown; relationship?: { kind?: unknown } } | null;
    const kind = o?.relationship?.kind;
    if (!o || typeof o.person_id !== 'string' || typeof o.name !== 'string' || !KINDS.includes(kind as RelationshipKind)) return [];
    return [{ person_id: o.person_id, name: o.name, kind: kind as RelationshipKind }];
  });
}

/** GET /relationships (PersonRelationship[]). Only `kind` is kept: confidence, source and evidence are never shown. */
export const listRelationships = async (): Promise<Load<PersonRelationshipView[]>> => asList(await load('/relationships', parseRelationships));
