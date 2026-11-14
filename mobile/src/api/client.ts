/**
 * The phone's REST client. Live once paired (base URL + device token set by the bus provider);
 * otherwise canned data. Read calls return `Sampled<T>`: `sample: true` means canned data, and
 * the screen labels it "sample".
 */
import type { DailyMission, Debrief, Person, SessionSummary, Streak, WeeklyReport } from '@/bus/contracts';
import { SAMPLE_DEBRIEF, SAMPLE_MISSION, SAMPLE_PEOPLE, SAMPLE_SESSIONS, SAMPLE_STREAK, SAMPLE_WEEKLY } from '@/bus/sample';

export interface Sampled<T> { data: T; sample: boolean }
export interface AppInfo { app_id: string; name: string; origin: string | null; status: 'pending' | 'approved' | 'revoked'; created_at: number; last_used: number | null; buzzes: number }
export interface DebriefPayload { session_id: string; data: Debrief; audio_url: string | null }

let api: { url: string; token: string } | null = null;
export function setApi(next: { url: string; token: string } | null): void { api = next; }
export const isMock = () => api === null;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function http<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (!api) throw new Error('not paired');
  let res: Response;
  try {
    res = await fetch(api.url + path, {
      method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', 'X-Device-Token': api.token },
    });
  } catch {
    throw new Error('Cannot reach the laptop.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? `HTTP ${res.status}`);
  return data as T;
}

async function sampled<T>(path: string, fallback: T, ok: (v: T) => boolean): Promise<Sampled<T>> {
  if (!api) { await wait(120); return { data: fallback, sample: true }; }
  try {
    const data = await http<T>(path);
    return ok(data) ? { data, sample: false } : { data: fallback, sample: true };
  } catch {
    return { data: fallback, sample: true };
  }
}

export function mediaUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:/.test(path)) return path;
  return api ? api.url + path : null;
}

export const getMissionToday = () => sampled<DailyMission>('/mission/today', SAMPLE_MISSION, (v) => Boolean(v?.text));
export const getStreak = () => sampled<Streak>('/streak', SAMPLE_STREAK, (v) => Array.isArray(v?.week) && v.week.length === 7);
export const listPeople = () => sampled<Person[]>('/people', SAMPLE_PEOPLE, (v) => Array.isArray(v) && v.length > 0);
export const listSessions = () => sampled<SessionSummary[]>('/sessions', SAMPLE_SESSIONS, (v) => Array.isArray(v) && v.length > 0);
export const getWeeklyReport = () => sampled<WeeklyReport>('/report/weekly', SAMPLE_WEEKLY, (v) => Array.isArray(v?.trend) && v.trend.length > 0);
export const getDebrief = (id: string) => sampled<DebriefPayload>(`/sessions/${encodeURIComponent(id)}/debrief`, { session_id: 's-sample', data: SAMPLE_DEBRIEF, audio_url: null }, (v) => Boolean(v?.data));

export async function chooseMission(focus_rule_id: string): Promise<DailyMission> {
  if (api) return http<DailyMission>('/mission/choose', 'POST', { focus_rule_id });
  await wait(120);
  const pick = SAMPLE_MISSION.suggestions.find((s) => s.focus_rule_id === focus_rule_id);
  return pick ? { ...SAMPLE_MISSION, focus_rule_id, text: pick.text, if_then: 'When I notice the cue, I do this once.', progress: 0 } : SAMPLE_MISSION;
}

export async function tagPerson(session_id: string, name: string): Promise<Person> {
  if (api) return http<Person>(`/sessions/${encodeURIComponent(session_id)}/person`, 'POST', { name });
  await wait(120);
  return SAMPLE_PEOPLE.find((p) => p.name === name) ?? { person_id: `p-${name.toLowerCase()}`, name, sessions: 1, pattern: 'One conversation so far. A pattern needs three.', brief: 'Nothing to brief yet.' };
}

// ---------- connected apps ----------
let mockApps: AppInfo[] = [
  { app_id: 'app-slides', name: 'Slide timer', origin: 'http://localhost:5500', status: 'pending', created_at: Date.now() / 1000 - 40, last_used: null, buzzes: 0 },
  { app_id: 'app-focus', name: 'Focus blocks', origin: 'https://focus.example', status: 'approved', created_at: Date.now() / 1000 - 259200, last_used: Date.now() / 1000 - 5400, buzzes: 42 },
];

export async function listApps(): Promise<Sampled<AppInfo[]>> {
  if (!api) { await wait(120); return { data: mockApps, sample: true }; }
  return { data: (await http<{ apps: AppInfo[] }>('/v1/apps')).apps, sample: false };
}

export async function approveApp(app_id: string): Promise<void> {
  if (api) return void (await http(`/v1/apps/${app_id}/approve`, 'POST', {}));
  mockApps = mockApps.map((a) => (a.app_id === app_id ? { ...a, status: 'approved' } : a));
}

export async function revokeApp(app_id: string): Promise<void> {
  if (api) return void (await http(`/v1/apps/${app_id}`, 'DELETE'));
  mockApps = mockApps.map((a) => (a.app_id === app_id ? { ...a, status: 'revoked' } : a));
}
