/**
 * Typed REST client for the backend chosen in lib/config.ts. There is no canned data: every
 * read returns the wearer's real data or a failure the screen shows, naming the address tried.
 * Pure result handling lives in results.ts.
 */
import type { CoachSpec, SessionMode } from '@/lib/bus/contracts';
import { apiBase } from '@/lib/config';
import { parseLibrary, parseTranscript } from '@/lib/conversations/model';
import type { LibrarySession, SessionTranscript } from '@/lib/conversations/types';
import { isNodeDetail } from '@/lib/graph/model';
import type { GraphNodeDetail } from '@/lib/graph/types';
import {
  ApiError, checked, errorMessage, graphFailure, httpErrorMessage, isArrayOf, isCoachSpec, isDebriefPayload, isObj, isPeople, isProfile,
  isSessionList, isWeekly, recordFailure, toBuiltCoach, toGraphResult, unreachableMessage, unreadableMessage,
  type BuiltCoach, type Fetched, type GraphResult, type RecordResult,
} from '@/lib/api/results';
import type { AppInfo, DebriefPayload, DeviceInfo, Pairing } from '@/lib/api/types';

export { ApiError, type BuildSource, type BuiltCoach, type Fetched, type GraphResult, type GraphSource } from '@/lib/api/results';
export type { AppInfo, DebriefPayload, DeviceInfo, Pairing } from '@/lib/api/types';

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const base = apiBase();
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError(unreachableMessage(base), 0);
  }
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(httpErrorMessage(base, path, res.status, body), res.status);
  return body as T;
}

const post = <T,>(path: string, body?: unknown) => http<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
const unreadable = (path: string) => new ApiError(unreadableMessage(apiBase(), path), 0);

/** GET `path` and validate it; never throws. */
async function read<T>(path: string, valid: (v: unknown) => v is T): Promise<Fetched<T>> {
  try {
    return checked(await http<unknown>(path), valid, apiBase(), path);
  } catch (e) {
    return { ok: false, error: errorMessage(e, unreachableMessage(apiBase())) };
  }
}

/** Turn "/media/x.mp3" into an absolute URL on the backend. */
export function mediaUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:/.test(path)) return path;
  return apiBase() + path;
}

// ---------- coaches ----------
const isCoachList = isArrayOf<CoachSpec>((v) => isObj(v) && typeof v.id === 'string' && typeof v.name === 'string');

export async function listCoaches(): Promise<CoachSpec[]> {
  const body = await http<unknown>('/coaches');
  if (!isCoachList(body)) throw unreadable('/coaches');
  return body;
}
/** POST /coaches/build. The reply wraps the coach: {spec, source, elapsed_ms, notes}. */
export async function buildCoach(goal: string): Promise<BuiltCoach> {
  return toBuiltCoach(await post<unknown>('/coaches/build', { goal }), apiBase(), '/coaches/build');
}
/** POST /coaches/personal answers the CoachSpec itself. */
export async function buildPersonalCoach(): Promise<CoachSpec> {
  const body = await post<unknown>('/coaches/personal');
  if (!isCoachSpec(body)) throw unreadable('/coaches/personal');
  return body;
}
export const saveCoach = (coach: CoachSpec) => http<CoachSpec>(`/coaches/${encodeURIComponent(coach.id)}`, { method: 'PUT', body: JSON.stringify(coach) });
export const activateCoach = (id: string) => post<CoachSpec>(`/coaches/${encodeURIComponent(id)}/activate`);

// ---------- session ----------
export const startSession = (mode: SessionMode = 'regular', coach_id?: string) => post('/session/start', { mode, coach_id }).then(() => undefined);
export const stopSession = () => post('/session/stop').then(() => undefined);
export const addBookmark = (text?: string) => post('/session/bookmark', { text, source: 'phone' }).then(() => undefined);
export const swapSpeakers = () => post('/calibration/swap-speakers').then(() => undefined);
export const calibrateMotion = () => post('/calibration/motion').then(() => undefined);

// ---------- pairing, devices, connected apps ----------
/** POST /pair: a fresh pairing from the backend. Throws when unreachable or unreadable. */
export async function createPairing(): Promise<Pairing> {
  const body = await post<unknown>('/pair', {});
  if (!isObj(body) || typeof body.qr !== 'string' || typeof body.code !== 'string' || typeof body.device_id !== 'string' || typeof body.server_url !== 'string') {
    throw unreadable('/pair');
  }
  return body as unknown as Pairing;
}

export async function listDevices(): Promise<DeviceInfo[]> {
  const body = await http<unknown>('/devices');
  if (!isObj(body) || !Array.isArray(body.devices)) throw unreadable('/devices');
  return body.devices as DeviceInfo[];
}

export async function listApps(): Promise<AppInfo[]> {
  const body = await http<unknown>('/v1/apps');
  if (!isObj(body) || !Array.isArray(body.apps)) throw unreadable('/v1/apps');
  return body.apps as AppInfo[];
}

export const approveApp = (app_id: string) => post(`/v1/apps/${encodeURIComponent(app_id)}/approve`).then(() => undefined);
export const revokeApp = (app_id: string) => http(`/v1/apps/${encodeURIComponent(app_id)}`, { method: 'DELETE' }).then(() => undefined);

export async function testBuzz(pattern: string, label: string): Promise<number> {
  const res = await post<{ delivered?: unknown }>('/haptics/test', { pattern, label });
  return typeof res?.delivered === 'number' ? res.delivered : 0;
}

// ---------- debrief, history, growth ----------
export type DebriefResult = RecordResult<DebriefPayload>;

/** GET /sessions/{id}/debrief. 'not_found' means this conversation has no debrief (yet, or ever). */
export async function getDebrief(session_id: string): Promise<DebriefResult> {
  const path = `/sessions/${encodeURIComponent(session_id)}/debrief`;
  try {
    const body = await http<unknown>(path);
    return isDebriefPayload(body) ? { kind: 'ok', data: body } : { kind: 'error', message: unreadableMessage(apiBase(), path) };
  } catch (e) {
    return recordFailure(e, apiBase());
  }
}

export const listSessions = () => read('/sessions', isSessionList);
export const getProfile = () => read('/profile', isProfile);
export const listPeople = () => read('/people', isPeople);
export const getWeeklyReport = () => read('/report/weekly', isWeekly);

// ---------- knowledge graph ----------
export async function getGraph(days: number): Promise<GraphResult> {
  const path = `/graph?days=${encodeURIComponent(String(days))}`;
  try {
    return toGraphResult(await http<unknown>(path), days, apiBase(), path);
  } catch (e) {
    return graphFailure(e, days, apiBase());
  }
}

/** Detail for one node, from GET /graph/node/{id}. A failure is thrown for the panel to show. */
export async function getGraphNode(id: string, shown: GraphResult): Promise<GraphNodeDetail> {
  const path = `/graph/node/${encodeURIComponent(id)}?days=${encodeURIComponent(String(shown.days))}`;
  const body = await http<unknown>(path);
  if (!isNodeDetail(body)) throw unreadable(path);
  return body;
}

/** GET /band/status. Only the optional `always_on` flag is read here; the rest comes over the bus. */
export async function getBandAlwaysOn(): Promise<boolean | null> {
  try {
    const body = await http<{ always_on?: unknown }>('/band/status');
    return typeof body?.always_on === 'boolean' ? body.always_on : null;
  } catch {
    return null;
  }
}

// ---------- conversations library ----------
/** The backend's maximum page (GET /sessions caps limit at 500; its default is 50). */
const LIBRARY_LIMIT = 500;
/** Where a library on screen came from. 'unreachable' and 'invalid' carry no data and say why. */
export type LibrarySource = 'live' | 'unreachable' | 'invalid';

export interface LibraryResult {
  data: LibrarySession[];
  source: LibrarySource;
  error: string | null;
}

export async function listConversations(includeAll: boolean): Promise<LibraryResult> {
  const path = includeAll ? `/sessions?include=all&limit=${LIBRARY_LIMIT}` : `/sessions?limit=${LIBRARY_LIMIT}`;
  try {
    const data = parseLibrary(await http<unknown>(path));
    if (!data) return { data: [], source: 'invalid', error: unreadableMessage(apiBase(), path) };
    return { data, source: 'live', error: null };
  } catch (e) {
    return { data: [], source: 'unreachable', error: errorMessage(e, unreachableMessage(apiBase())) };
  }
}

/** POST /sessions/{id}/keep: the wearer overrides the automatic keep decision. Throws on failure. */
export async function setKept(session_id: string, kept: boolean): Promise<void> {
  await post(`/sessions/${encodeURIComponent(session_id)}/keep`, { kept });
}

export type TranscriptResult = RecordResult<SessionTranscript>;

export async function getTranscript(session_id: string): Promise<TranscriptResult> {
  const path = `/sessions/${encodeURIComponent(session_id)}/transcript`;
  try {
    const data = parseTranscript(await http<unknown>(path));
    return data ? { kind: 'ok', data } : { kind: 'error', message: unreadableMessage(apiBase(), path) };
  } catch (e) {
    return recordFailure(e, apiBase());
  }
}

/** One conversation's summary (for the header): the library entry, from the full list. Null when absent. */
export async function findConversation(session_id: string): Promise<LibrarySession | null> {
  const r = await listConversations(true);
  return r.data.find((s) => s.session_id === session_id) ?? null;
}

/** A playable URL for a transcript's recording, or null when none was kept. */
export function recordingUrl(t: SessionTranscript): string | null {
  return mediaUrl(t.audio_url);
}
