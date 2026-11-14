/**
 * Typed REST client. With a backend URL set (lib/config.ts) every call goes to the backend;
 * otherwise it returns canned data after a short delay.
 *
 * Read calls return `Sampled<T>`: `sample: true` means the data is canned (mock mode, or the
 * backend had nothing / is not built yet), and the screen must label it "sample".
 */
import type {
  CoachSpec, DailyMission, Debrief, HabitProfile, Person, SessionMode, SessionSummary, Streak, WeeklyReport,
} from '@/lib/bus/contracts';
import {
  INTERVIEW_COACH, PERSONAL_COACH, REGULAR_POLICY, SAMPLE_COACHES, SAMPLE_DEBRIEF, SAMPLE_MISSION, SAMPLE_PEOPLE,
  SAMPLE_PROFILE, SAMPLE_SESSIONS, SAMPLE_STREAK, SAMPLE_WEEKLY,
} from '@/lib/bus/sample';
import { apiBase } from '@/lib/config';
import { parseLibrary, parseTranscript } from '@/lib/conversations/model';
import { SAMPLE_AUDIO_PREFIX, SAMPLE_LIBRARY, sampleAlias, sampleTranscript } from '@/lib/conversations/sample';
import { synthWav } from '@/lib/conversations/sample-audio';
import type { LibrarySession, SessionTranscript } from '@/lib/conversations/types';
import { isKnowledgeGraph, isNodeDetail } from '@/lib/graph/model';
import { sampleGraph, sampleNodeDetail } from '@/lib/graph/sample';
import type { GraphNodeDetail, KnowledgeGraph } from '@/lib/graph/types';

export interface Sampled<T> {
  data: T;
  sample: boolean;
}

export interface Pairing {
  server_url: string;
  device_id: string;
  device_token: string;
  code: string;
  /** The exact string to encode in the QR code. */
  qr: string;
}

export interface DeviceInfo {
  device_id: string;
  name: string;
  connected: boolean;
  paired: boolean;
  last_seen: number | null;
}

export interface AppInfo {
  app_id: string;
  name: string;
  origin: string | null;
  status: 'pending' | 'approved' | 'revoked';
  created_at: number;
  last_used: number | null;
  buzzes: number;
}

export interface DebriefPayload {
  session_id: string;
  data: Debrief;
  audio_url: string | null;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const base = apiBase();
  if (!base) throw new ApiError('no backend configured', 0);
  let res: Response;
  try {
    res = await fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  } catch {
    throw new ApiError(`Cannot reach the backend at ${base}`, 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body?.error?.message ?? body?.detail ?? `HTTP ${res.status}`, res.status);
  return body as T;
}

const post = <T,>(path: string, body?: unknown) => http<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });

/** Live value, or the canned one (flagged) when there is no backend or the call fails. */
async function sampled<T>(path: string, fallback: T, ok: (v: T) => boolean = () => true): Promise<Sampled<T>> {
  if (!apiBase()) {
    await wait(180);
    return { data: fallback, sample: true };
  }
  try {
    const data = await http<T>(path);
    return ok(data) ? { data, sample: false } : { data: fallback, sample: true };
  } catch {
    return { data: fallback, sample: true };
  }
}

export const isMock = () => apiBase() === null;

/** Turn "/media/x.mp3" into an absolute URL on the backend. */
export function mediaUrl(path: string | null): string | null {
  if (!path) return null;
  if (/^https?:/.test(path)) return path;
  const base = apiBase();
  return base ? base + path : null;
}

// ---------- coaches ----------
let mockCoaches: CoachSpec[] = SAMPLE_COACHES;

export async function listCoaches(): Promise<CoachSpec[]> {
  if (isMock()) {
    await wait(150);
    return mockCoaches;
  }
  return http<CoachSpec[]>('/coaches');
}

function titleFromGoal(goal: string): string {
  const words = goal.replace(/[^\p{L}\p{N}\s'’-]/gu, ' ').split(/\s+/).filter((w) => w.length > 3);
  const pick = words.find((w) => /interview|listen|pitch|negotiat|meeting|date|present|confiden/i.test(w)) ?? words[0] ?? 'Custom';
  return pick.charAt(0).toUpperCase() + pick.slice(1).toLowerCase();
}

/** Takes about 2.5 s in mock mode so the "being written" state is visible. */
export async function buildCoach(goal: string): Promise<CoachSpec> {
  if (!isMock()) return post<CoachSpec>('/coaches/build', { goal });
  await wait(2500);
  const quoted = [...goal.matchAll(/[“"'‘]([^”"'’]{2,20})[”"'’]/g)].map((m) => m[1].toLowerCase());
  const fillers = quoted.length ? [...new Set([...quoted, 'um', 'uh'])] : ['um', 'uh', 'like', 'you know'];
  return {
    ...INTERVIEW_COACH,
    id: `custom-${Date.now().toString(36)}`,
    name: titleFromGoal(goal),
    goal,
    kind: 'custom',
    filler_words: fillers,
    keyterms: quoted.length ? quoted : ['framework', 'hypothesis'],
    questions: {
      said_crutch_word: { type: 'noul', instructions: `Does the wearer's turn contain ${fillers.slice(0, 2).map((f) => `“${f}”`).join(' or ')} used as a filler?` },
      sounds_confident: { type: 'choice', instructions: 'How does the turn come across?', criteria: { confident: 'States the point and stops', hedged: 'Qualifies the point before or after making it', unsure: 'Trails off or asks for reassurance' } },
      leads_with_answer: { type: 'score', instructions: 'Where is the direct answer?', criteria: ['Never answers', 'At the end', 'In the middle', 'In the first sentence'] },
    },
    nudge_rules: [
      { id: 'pace', when: 'metrics.wpm > 200', haptic: 'slow_down', message: 'Slow down', cooldown_s: 120, enabled: true },
      { id: 'crutch', when: 'judge.said_crutch_word.p >= 0.8', haptic: 'filler', message: 'Pause', cooldown_s: 30, enabled: true },
      { id: 'hedged', when: "judge.sounds_confident.choice == 'hedged'", haptic: 'tap', message: 'Say it plainly', cooldown_s: 90, enabled: true },
      { id: 'long_turn', when: 'metrics.monologue_s > 45', haptic: 'wrap_up', message: 'Ask a question', cooldown_s: 90, enabled: true },
    ],
    nudge_policy: REGULAR_POLICY,
    debrief_rubric: `Judge the conversation against this goal: ${goal}. Lead with a number, quote one answer, give one fix.`,
  };
}

export async function buildPersonalCoach(): Promise<CoachSpec> {
  if (!isMock()) return post<CoachSpec>('/coaches/personal');
  await wait(600);
  return PERSONAL_COACH;
}

export async function saveCoach(coach: CoachSpec): Promise<CoachSpec> {
  if (!isMock()) return http<CoachSpec>(`/coaches/${encodeURIComponent(coach.id)}`, { method: 'PUT', body: JSON.stringify(coach) });
  await wait(200);
  mockCoaches = [...mockCoaches.filter((c) => c.id !== coach.id), coach];
  return coach;
}

export async function activateCoach(id: string): Promise<CoachSpec | null> {
  if (!isMock()) return post<CoachSpec>(`/coaches/${encodeURIComponent(id)}/activate`);
  await wait(200);
  return mockCoaches.find((c) => c.id === id) ?? null;
}

// ---------- session ----------
export const startSession = (mode: SessionMode = 'regular', coach_id?: string) =>
  isMock() ? wait(100) : post('/session/start', { mode, coach_id }).then(() => undefined);
export const stopSession = () => (isMock() ? wait(100) : post('/session/stop').then(() => undefined));
export const addBookmark = (text?: string) => (isMock() ? wait(50) : post('/session/bookmark', { text, source: 'phone' }).then(() => undefined));
export const swapSpeakers = () => (isMock() ? wait(150) : post('/calibration/swap-speakers').then(() => undefined));
export const calibrateMotion = () => (isMock() ? wait(150) : post('/calibration/motion').then(() => undefined));

// ---------- pairing, devices, connected apps ----------
export async function createPairing(): Promise<Pairing> {
  if (!isMock()) return post<Pairing>('/pair', {});
  await wait(250);
  const payload = { server_url: 'http://192.168.1.20:8000', device_id: 'd-demo', device_token: 'demo-token-not-real' };
  return { ...payload, code: 'K7M2QX', qr: JSON.stringify(payload) };
}

let mockApps: AppInfo[] = [
  { app_id: 'app-slides', name: 'Slide timer', origin: 'http://localhost:5500', status: 'pending', created_at: Date.now() / 1000 - 40, last_used: null, buzzes: 0 },
  { app_id: 'app-pomodoro', name: 'Focus blocks', origin: 'https://focus.example', status: 'approved', created_at: Date.now() / 1000 - 86400 * 3, last_used: Date.now() / 1000 - 5400, buzzes: 42 },
];

export async function listDevices(): Promise<Sampled<DeviceInfo[]>> {
  if (isMock()) {
    await wait(150);
    return { sample: true, data: [{ device_id: 'd-demo', name: 'iPhone', connected: true, paired: true, last_seen: Date.now() / 1000 }] };
  }
  const res = await http<{ devices: DeviceInfo[] }>('/devices');
  return { sample: false, data: res.devices };
}

export async function listApps(): Promise<Sampled<AppInfo[]>> {
  if (isMock()) {
    await wait(150);
    return { sample: true, data: mockApps };
  }
  const res = await http<{ apps: AppInfo[] }>('/v1/apps');
  return { sample: false, data: res.apps };
}

export async function approveApp(app_id: string): Promise<void> {
  if (!isMock()) return void (await post(`/v1/apps/${app_id}/approve`));
  await wait(150);
  mockApps = mockApps.map((a) => (a.app_id === app_id ? { ...a, status: 'approved' } : a));
}

export async function revokeApp(app_id: string): Promise<void> {
  if (!isMock()) return void (await http(`/v1/apps/${app_id}`, { method: 'DELETE' }));
  await wait(150);
  mockApps = mockApps.map((a) => (a.app_id === app_id ? { ...a, status: 'revoked' } : a));
}

export async function testBuzz(pattern: string, label: string): Promise<number> {
  if (isMock()) return 0;
  const res = await post<{ delivered: number }>('/haptics/test', { pattern, label });
  return res.delivered;
}

// ---------- debrief, history, growth ----------
export async function getDebrief(session_id: string): Promise<Sampled<DebriefPayload>> {
  return sampled(`/sessions/${encodeURIComponent(session_id)}/debrief`, { session_id: 's-sample', data: SAMPLE_DEBRIEF, audio_url: null }, (v) => Boolean(v?.data));
}

export const listSessions = () => sampled<SessionSummary[]>('/sessions', SAMPLE_SESSIONS, (v) => Array.isArray(v) && v.length > 0);
export const getProfile = () => sampled<HabitProfile>('/profile', SAMPLE_PROFILE, (v) => v.sessions > 0);
export const getMissionToday = () => sampled<DailyMission>('/mission/today', SAMPLE_MISSION, (v) => Boolean(v?.text));
export const getStreak = () => sampled<Streak>('/streak', SAMPLE_STREAK, (v) => Array.isArray(v?.week));
export const listPeople = () => sampled<Person[]>('/people', SAMPLE_PEOPLE, (v) => Array.isArray(v) && v.length > 0);
export const getWeeklyReport = () => sampled<WeeklyReport>('/report/weekly', SAMPLE_WEEKLY, (v) => Array.isArray(v?.trend) && v.trend.length > 0);

export async function chooseMission(focus_rule_id: string): Promise<DailyMission> {
  if (!isMock()) return post<DailyMission>('/mission/choose', { focus_rule_id });
  await wait(150);
  const pick = SAMPLE_MISSION.suggestions.find((s) => s.focus_rule_id === focus_rule_id);
  return pick ? { ...SAMPLE_MISSION, focus_rule_id, text: pick.text, progress: 0 } : SAMPLE_MISSION;
}

// ---------- knowledge graph ----------
/**
 * Where a graph on screen came from. Anything but 'live' is the built-in sample and is
 * labelled "sample"; 'unreachable' and 'invalid' also say why.
 */
export type GraphSource = 'live' | 'mock' | 'backend-sample' | 'unreachable' | 'invalid';

export interface GraphResult {
  data: KnowledgeGraph;
  sample: boolean;
  source: GraphSource;
  error: string | null;
  /** The window this graph was loaded with; node detail must ask for the same one. */
  days: number;
}

export async function getGraph(days: number): Promise<GraphResult> {
  const fallback = (source: GraphSource, error: string | null = null): GraphResult => ({ data: sampleGraph(days), sample: true, source, error, days });
  if (isMock()) {
    await wait(220);
    return fallback('mock');
  }
  try {
    const body = await http<unknown>(`/graph?days=${encodeURIComponent(String(days))}`);
    if (!isKnowledgeGraph(body)) return fallback('invalid', 'The backend answered /graph with something that is not a graph.');
    if (body.sample) return fallback('backend-sample');
    return { data: body, sample: false, source: 'live', error: null, days };
  } catch (e) {
    return fallback('unreachable', e instanceof Error ? e.message : 'Cannot reach the backend.');
  }
}

/**
 * Detail for one node. When the graph on screen is the sample, the detail comes from the
 * sample too; otherwise from GET /graph/node/{id}, and a failure is thrown for the panel to show.
 */
export async function getGraphNode(id: string, shown: GraphResult): Promise<Sampled<GraphNodeDetail>> {
  if (shown.sample) {
    await wait(120);
    const detail = sampleNodeDetail(shown.data, id);
    if (!detail) throw new ApiError('That node is not in the sample graph.', 404);
    return { data: detail, sample: true };
  }
  const body = await http<unknown>(`/graph/node/${encodeURIComponent(id)}?days=${encodeURIComponent(String(shown.days))}`);
  if (!isNodeDetail(body)) throw new ApiError('The backend answered with something that is not a node.', 0);
  return { data: body, sample: false };
}

/** GET /band/status. Only the optional `always_on` flag is read here; the rest comes over the bus. */
export async function getBandAlwaysOn(): Promise<boolean | null> {
  if (isMock()) return null;
  try {
    const body = await http<{ always_on?: unknown }>('/band/status');
    return typeof body?.always_on === 'boolean' ? body.always_on : null;
  } catch {
    return null;
  }
}

export async function tagPerson(session_id: string, name: string, person_id?: string): Promise<Person> {
  if (!isMock()) return post<Person>(`/sessions/${encodeURIComponent(session_id)}/person`, { name, person_id });
  await wait(150);
  return SAMPLE_PEOPLE.find((p) => p.name === name) ?? { person_id: `p-${name.toLowerCase()}`, name, sessions: 1, pattern: 'One conversation so far. A pattern needs three.', brief: 'Nothing to brief yet.' };
}

// ---------- conversations library ----------
/**
 * Where a library on screen came from. 'mock' is the built-in sample (labelled "sample");
 * 'unreachable' and 'invalid' carry no data and say why.
 */
export type LibrarySource = 'live' | 'mock' | 'unreachable' | 'invalid';

export interface LibraryResult {
  data: LibrarySession[];
  sample: boolean;
  source: LibrarySource;
  error: string | null;
}

/** Overrides the wearer made in mock mode, so Keep/Hide stick for the tab. */
let mockKept: Record<string, boolean> = {};

function mockLibrary(): LibrarySession[] {
  return SAMPLE_LIBRARY.map((s) => {
    if (!(s.session_id in mockKept)) return s;
    const kept = mockKept[s.session_id];
    return { ...s, kept, kept_reason: kept ? 'keep' : s.kept ? null : s.kept_reason };
  });
}

export async function listConversations(includeAll: boolean): Promise<LibraryResult> {
  if (isMock()) {
    await wait(200);
    const all = mockLibrary();
    return { data: includeAll ? all : all.filter((s) => s.kept), sample: true, source: 'mock', error: null };
  }
  try {
    const body = await http<unknown>(includeAll ? '/sessions?include=all' : '/sessions');
    const data = parseLibrary(body);
    if (!data) return { data: [], sample: false, source: 'invalid', error: 'The backend answered /sessions with something that is not a list of conversations.' };
    return { data, sample: false, source: 'live', error: null };
  } catch (e) {
    return { data: [], sample: false, source: 'unreachable', error: e instanceof Error ? e.message : 'Cannot reach the backend.' };
  }
}

/** POST /sessions/{id}/keep: the wearer overrides the automatic keep decision. Throws on failure. */
export async function setKept(session_id: string, kept: boolean): Promise<void> {
  if (isMock()) {
    await wait(260);
    mockKept = { ...mockKept, [session_id]: kept };
    return;
  }
  await post(`/sessions/${encodeURIComponent(session_id)}/keep`, { kept });
}

export type TranscriptResult =
  | { kind: 'ok'; data: SessionTranscript; sample: boolean }
  | { kind: 'not_found' }
  | { kind: 'error'; message: string };

export async function getTranscript(session_id: string): Promise<TranscriptResult> {
  if (isMock()) {
    await wait(220);
    const t = sampleTranscript(session_id);
    return t ? { kind: 'ok', data: t, sample: true } : { kind: 'not_found' };
  }
  try {
    const body = await http<unknown>(`/sessions/${encodeURIComponent(session_id)}/transcript`);
    const data = parseTranscript(body);
    return data ? { kind: 'ok', data, sample: false } : { kind: 'error', message: 'The backend sent a transcript this screen could not read.' };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return { kind: 'not_found' };
    return { kind: 'error', message: e instanceof Error ? e.message : 'Cannot reach the backend.' };
  }
}

/** One conversation's summary (for the header): the library entry, from the full list. Null when absent. */
export async function findConversation(session_id: string): Promise<LibrarySession | null> {
  const r = await listConversations(true);
  const id = isMock() ? sampleAlias(session_id) : session_id;
  return r.data.find((s) => s.session_id === id) ?? null;
}

const sampleAudioUrls = new Map<string, string>();

/**
 * A playable URL for a transcript's recording: the backend path made absolute, or for the
 * sample a synthesised WAV (blob URL, made once per session). Null when there is no recording.
 */
export function recordingUrl(t: SessionTranscript): string | null {
  if (!t.audio_url) return null;
  if (!t.audio_url.startsWith(SAMPLE_AUDIO_PREFIX)) return mediaUrl(t.audio_url);
  if (typeof window === 'undefined') return null;
  const cached = sampleAudioUrls.get(t.session_id);
  if (cached) return cached;
  const total = t.turns.reduce((m, x) => Math.max(m, x.end), t.duration_s ?? 0) + t.audio_offset_s;
  const wav = synthWav(t.turns, total, t.audio_offset_s);
  const url = URL.createObjectURL(new Blob([wav.buffer as ArrayBuffer], { type: 'audio/wav' }));
  sampleAudioUrls.set(t.session_id, url);
  return url;
}
