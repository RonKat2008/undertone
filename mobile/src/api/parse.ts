/**
 * Runtime shape checks for what the laptop sends. Real data is often sparse (a conversation that
 * closed quietly, a person with one conversation, a week with no baseline yet), so these keep what
 * is usable, fill gaps with explicit "nothing" values (null, '', []), and return null only when the
 * envelope itself is wrong. Screens render "–" or leave a line out; never "undefined" or "NaN".
 */
import type { BookmarkReview, DailyMission, Debrief, Person, SessionMode, Streak, TimelinePoint, WeeklyReport } from '@/bus/contracts';

type Obj = Record<string, unknown>;
export type MetricKey = keyof Debrief['numbers'];
/** A conversation's headline numbers. Any of them may be missing. */
export type Numbers = { [K in MetricKey]: number | null };
/** A debrief as the screens use it: every part may be empty. */
export type DebriefView = Omit<Debrief, 'numbers'> & { numbers: Numbers };

export const METRIC_KEYS: readonly MetricKey[] = ['talk_ratio', 'interruptions', 'questions', 'fillers_per_min', 'wpm'];

export const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (isStr(v) ? v : '');
const num = (v: unknown): number | null => (isNum(v) ? v : null);

export function parseNumbers(v: unknown): Numbers {
  const o = isObj(v) ? v : {};
  return { talk_ratio: num(o.talk_ratio), interruptions: num(o.interruptions), questions: num(o.questions), fillers_per_min: num(o.fillers_per_min), wpm: num(o.wpm) };
}

// ---------- formatting for possibly-missing numbers ----------
const DASH = '–';
export const fmtPct = (v: number | null) => (v === null ? DASH : `${Math.round(v * 100)}%`);
export const fmtInt = (v: number | null) => (v === null ? DASH : String(Math.round(v)));
export const fmtOne = (v: number | null) => (v === null ? DASH : v.toFixed(1));

// ---------- sessions ----------
/** A History row. Everything but the id may be missing on a sparse conversation. A missing `kept` means kept. */
export interface SessionListItem {
  session_id: string;
  started_at: string; // ISO; may be ''
  duration_s: number | null;
  coach_name: string;
  mode: SessionMode;
  person_id: string | null;
  headline_fact: string | null;
  numbers: Numbers | null;
  kept?: boolean;
  kept_reason?: string | null;
  audio_url?: string | null;
}

function parseSession(v: unknown): SessionListItem | null {
  if (!isObj(v) || !isStr(v.session_id) || !v.session_id) return null;
  return {
    session_id: v.session_id,
    started_at: str(v.started_at),
    duration_s: num(v.duration_s),
    coach_name: str(v.coach_name),
    mode: v.mode === 'practice' ? 'practice' : 'regular',
    person_id: isStr(v.person_id) && v.person_id ? v.person_id : null,
    headline_fact: isStr(v.headline_fact) && v.headline_fact.trim() ? v.headline_fact : null,
    numbers: isObj(v.numbers) ? parseNumbers(v.numbers) : null,
    kept: typeof v.kept === 'boolean' ? v.kept : undefined,
    kept_reason: isStr(v.kept_reason) ? v.kept_reason : null,
    audio_url: isStr(v.audio_url) && v.audio_url ? v.audio_url : null,
  };
}

export function parseSessions(v: unknown): SessionListItem[] | null {
  if (!Array.isArray(v)) return null;
  return v.map(parseSession).filter((s): s is SessionListItem => s !== null);
}

// ---------- people ----------
export function parsePeople(v: unknown): Person[] | null {
  if (!Array.isArray(v)) return null;
  return v.flatMap((p): Person[] => {
    if (!isObj(p) || !isStr(p.person_id) || !isStr(p.name) || !p.name.trim()) return [];
    return [{ person_id: p.person_id, name: p.name, sessions: isNum(p.sessions) ? Math.max(0, Math.round(p.sessions)) : 0, pattern: str(p.pattern), brief: str(p.brief) }];
  });
}

// ---------- today ----------
export function parseStreak(v: unknown): Streak | null {
  if (!isObj(v) || !isNum(v.days)) return null;
  const raw = Array.isArray(v.week) ? v.week.slice(-7).map((d) => d === true) : [];
  const week = [...Array<boolean>(7 - raw.length).fill(false), ...raw];
  return { days: Math.max(0, Math.round(v.days)), freeze_available: v.freeze_available === true, week };
}

/** null: unreadable. 'none': the laptop has no mission for today yet. */
export function parseMission(v: unknown): DailyMission | 'none' | null {
  if (!isObj(v)) return null;
  if (!isStr(v.text) || !v.text.trim()) return 'none';
  const target = isNum(v.target) && v.target >= 1 ? Math.round(v.target) : 1;
  const progress = isNum(v.progress) ? Math.max(0, Math.round(v.progress)) : 0;
  const suggestions = Array.isArray(v.suggestions)
    ? v.suggestions.flatMap((s) => (isObj(s) && isStr(s.focus_rule_id) && isStr(s.text) && s.text.trim() ? [{ focus_rule_id: s.focus_rule_id, text: s.text }] : []))
    : [];
  return { date: str(v.date), focus_rule_id: str(v.focus_rule_id), text: v.text, if_then: str(v.if_then), target, progress, done: v.done === true, suggestions };
}

/** null: unreadable. 'none': not enough conversations for a weekly comparison yet. */
export function parseWeekly(v: unknown): WeeklyReport | 'none' | null {
  if (!isObj(v)) return null;
  const trend = Array.isArray(v.trend)
    ? v.trend.flatMap((t) => (isObj(t) && METRIC_KEYS.includes(t.metric as MetricKey) && isNum(t.from) && isNum(t.to) ? [{ metric: t.metric as MetricKey, from: t.from, to: t.to }] : []))
    : [];
  const biggest = str(v.biggest_improvement);
  if (trend.length === 0 && !biggest.trim()) return 'none';
  return { week_of: str(v.week_of), trend, best_session_id: isStr(v.best_session_id) ? v.best_session_id : null, biggest_improvement: biggest };
}

// ---------- debrief ----------
function parseBookmark(v: unknown): BookmarkReview | null {
  if (!isObj(v) || !isNum(v.ts)) return null;
  return {
    ts: v.ts,
    source: v.source === 'promise' ? 'promise' : 'phone',
    snippet: str(v.snippet),
    what_happened: str(v.what_happened),
    follow_up: isStr(v.follow_up) && v.follow_up ? v.follow_up : null,
  };
}

function parsePoint(v: unknown): TimelinePoint | null {
  if (!isObj(v) || !isNum(v.t)) return null;
  return { t: v.t, wpm: isNum(v.wpm) ? v.wpm : 0, volume_db: isNum(v.volume_db) ? v.volume_db : -34, hand_energy: isNum(v.hand_energy) ? v.hand_energy : 0 };
}

/** null when it is not a debrief at all. Missing parts come back empty. */
export function parseDebrief(v: unknown): DebriefView | null {
  if (!isObj(v)) return null;
  const notes = Array.isArray(v.notes) ? v.notes.filter((n): n is string => isStr(n) && n.trim().length > 0) : [];
  const bookmarks = Array.isArray(v.bookmarks) ? v.bookmarks.map(parseBookmark).filter((b): b is BookmarkReview => b !== null) : [];
  const timeline = Array.isArray(v.timeline) ? v.timeline.map(parsePoint).filter((p): p is TimelinePoint => p !== null).sort((a, b) => a.t - b.t) : [];
  return {
    headline_fact: str(v.headline_fact),
    strength: str(v.strength),
    one_fix: str(v.one_fix),
    if_then: str(v.if_then),
    numbers: parseNumbers(v.numbers),
    best_moment_quote: str(v.best_moment_quote),
    vs_last_time: isStr(v.vs_last_time) && v.vs_last_time ? v.vs_last_time : null,
    notes,
    bookmarks,
    timeline,
    better_version: null,
  };
}

export interface DebriefPayload { session_id: string; data: DebriefView; audio_url: string | null }

export function parseDebriefPayload(v: unknown, fallbackId: string): DebriefPayload | null {
  if (!isObj(v)) return null;
  const data = parseDebrief(v.data);
  if (!data) return null;
  return { session_id: isStr(v.session_id) && v.session_id ? v.session_id : fallbackId, data, audio_url: isStr(v.audio_url) && v.audio_url ? v.audio_url : null };
}
