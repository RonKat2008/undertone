/**
 * Pure helpers for the conversations library and the conversation page: runtime shape checks,
 * day grouping, search, kept/filtered labels, active-turn lookup and seek maths, filler marking.
 * No React, no fetch; tested in conversations.test.ts.
 */
import type { KeptReason, LibrarySession, SessionTranscript, TranscriptTurn } from './types';

// ---------- runtime shape checks ----------
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const REASONS: readonly KeptReason[] = ['keep', 'trivial', 'noise', 'sensitive'];

/** One SessionSummary from the backend, normalised; null when it is not one. */
export function parseLibrarySession(raw: unknown): LibrarySession | null {
  if (!isObj(raw) || !isStr(raw.session_id) || !raw.session_id || !isStr(raw.started_at)) return null;
  if (!Number.isFinite(Date.parse(raw.started_at))) return null;
  const n = isObj(raw.numbers) ? raw.numbers : {};
  const num = (v: unknown) => (isNum(v) ? v : 0);
  const reason = REASONS.includes(raw.kept_reason as KeptReason) ? (raw.kept_reason as KeptReason) : null;
  return {
    session_id: raw.session_id,
    started_at: raw.started_at,
    duration_s: isNum(raw.duration_s) ? Math.max(0, raw.duration_s) : 0,
    coach_name: isStr(raw.coach_name) ? raw.coach_name : '',
    mode: raw.mode === 'practice' ? 'practice' : 'regular',
    person_id: isStr(raw.person_id) ? raw.person_id : null,
    headline_fact: isStr(raw.headline_fact) ? raw.headline_fact : '',
    numbers: { talk_ratio: num(n.talk_ratio), interruptions: num(n.interruptions), questions: num(n.questions), fillers_per_min: num(n.fillers_per_min), wpm: num(n.wpm) },
    kept: raw.kept === false ? false : true,
    kept_reason: reason,
    audio_url: isStr(raw.audio_url) && raw.audio_url ? raw.audio_url : null,
  };
}

/** A /sessions body: null if it is not a list; entries that are not sessions are dropped. */
export function parseLibrary(raw: unknown): LibrarySession[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.map(parseLibrarySession).filter((s): s is LibrarySession => s !== null);
}

function parseTurn(raw: unknown, i: number): TranscriptTurn | null {
  if (!isObj(raw) || !isStr(raw.text) || !isNum(raw.start)) return null;
  if (raw.speaker !== 'me' && raw.speaker !== 'other') return null;
  const start = Math.max(0, raw.start);
  return {
    turn_id: isStr(raw.turn_id) && raw.turn_id ? raw.turn_id : `t${i}`,
    speaker: raw.speaker,
    text: raw.text,
    start,
    end: isNum(raw.end) && raw.end >= start ? raw.end : start,
    wpm: isNum(raw.wpm) ? raw.wpm : 0,
    fillers: Array.isArray(raw.fillers) ? raw.fillers.filter(isStr) : [],
  };
}

/** A /sessions/{id}/transcript body, normalised (turns sorted by start); null when it is not one. */
export function parseTranscript(raw: unknown): SessionTranscript | null {
  if (!isObj(raw) || !isStr(raw.session_id) || !isStr(raw.started_at) || !Array.isArray(raw.turns)) return null;
  const turns = raw.turns.map(parseTurn).filter((t): t is TranscriptTurn => t !== null);
  return {
    session_id: raw.session_id,
    started_at: raw.started_at,
    duration_s: isNum(raw.duration_s) ? raw.duration_s : null,
    audio_url: isStr(raw.audio_url) && raw.audio_url ? raw.audio_url : null,
    audio_offset_s: isNum(raw.audio_offset_s) ? raw.audio_offset_s : 0,
    turns: [...turns].sort((a, b) => a.start - b.start),
  };
}

// ---------- days ----------
/** "2026-11-13" in the zone `offsetMin` minutes behind UTC (Date#getTimezoneOffset convention). */
export function dayKey(iso: string, offsetMin: number = new Date(iso).getTimezoneOffset()): string {
  const t = Date.parse(iso) - offsetMin * 60_000;
  return new Date(t).toISOString().slice(0, 10);
}

export interface DayGroup<T> {
  key: string;
  items: T[];
}

/** Groups by local day, newest day first and newest first within a day. */
export function groupByDay<T extends { started_at: string }>(items: readonly T[], keyOf: (iso: string) => string = (iso) => dayKey(iso)): DayGroup<T>[] {
  const sorted = [...items].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
  const groups: DayGroup<T>[] = [];
  for (const item of sorted) {
    const key = keyOf(item.started_at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }
  return groups;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "Friday 13 November" for a day key; the year only when it is not `todayKey`'s. */
export function longDate(key: string, todayKey: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  const year = key.slice(0, 4) !== todayKey.slice(0, 4) ? ` ${d.getUTCFullYear()}` : '';
  return `${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year}`;
}

/** "Today", "Yesterday", or null (the long date stands alone). */
export function relativeDayName(key: string, todayKey: string): string | null {
  if (key === todayKey) return 'Today';
  const y = new Date(Date.parse(`${todayKey}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return key === y ? 'Yesterday' : null;
}

/** "16:02" in the same zone convention as dayKey. */
export function timeOfDay(iso: string, offsetMin: number = new Date(iso).getTimezoneOffset()): string {
  const d = new Date(Date.parse(iso) - offsetMin * 60_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

// ---------- kept or filtered ----------
const REASON_LABEL: Record<Exclude<KeptReason, 'keep'>, string> = {
  trivial: 'Too short to learn from',
  noise: 'Background speech',
  sensitive: 'Marked private',
};

/** Why a capture was filtered out, in plain words; null for a kept one. */
export function reasonLabel(session: Pick<LibrarySession, 'kept' | 'kept_reason'>): string | null {
  if (session.kept) return null;
  if (session.kept_reason && session.kept_reason !== 'keep') return REASON_LABEL[session.kept_reason];
  return 'Hidden by you';
}

/** A new list with one session's kept flag overridden by the wearer. */
export function applyKept(list: readonly LibrarySession[], id: string, kept: boolean): LibrarySession[] {
  return list.map((s) => (s.session_id === id ? { ...s, kept, kept_reason: kept ? 'keep' : null } : s));
}

/** A new list with one session put back as it was (the rollback of applyKept). */
export function restoreSession(list: readonly LibrarySession[], previous: LibrarySession): LibrarySession[] {
  return list.map((s) => (s.session_id === previous.session_id ? previous : s));
}

// ---------- search ----------
/** Every whitespace-separated term must appear in the headline or the person's name (case-insensitive). */
export function filterSessions<T extends Pick<LibrarySession, 'headline_fact' | 'person_id'>>(
  items: readonly T[], query: string, personName: (id: string | null) => string | null,
): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...items];
  return items.filter((s) => {
    const hay = `${s.headline_fact} ${personName(s.person_id) ?? ''}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

// ---------- library URL state: ?all=1&q=… (other params such as ?bus= are kept) ----------
export interface LibraryUrlState {
  all: boolean;
  q: string;
}

export function parseLibraryUrl(search: string): LibraryUrlState {
  const p = new URLSearchParams(search);
  return { all: p.get('all') === '1', q: (p.get('q') ?? '').slice(0, 200) };
}

export function writeLibraryUrl(current: string, state: LibraryUrlState): string {
  const p = new URLSearchParams(current);
  if (state.all) p.set('all', '1');
  else p.delete('all');
  if (state.q.trim()) p.set('q', state.q);
  else p.delete('q');
  const s = p.toString();
  return s ? `?${s}` : '';
}

// ---------- playback ----------
/** Where a turn starts in the audio. */
export function audioPositionForTurn(turn: Pick<TranscriptTurn, 'start'>, offset: number): number {
  return Math.max(0, turn.start + offset);
}

/** Conversation time for an audio position. */
export function conversationTime(audioTime: number, offset: number): number {
  return audioTime - offset;
}

/** A seek target kept inside the recording. An unknown duration only clamps at zero. */
export function clampSeek(t: number, duration: number | null): number {
  const lo = Math.max(0, t);
  return duration !== null && Number.isFinite(duration) && duration > 0 ? Math.min(lo, duration) : lo;
}

/** Scrubber fraction (0..1) for a time. */
export function fractionOf(t: number, duration: number | null): number {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(1, Math.max(0, t / duration));
}

/** Time for a pointer x inside a scrubber spanning [left, left + width]. */
export function timeAtPointer(x: number, left: number, width: number, duration: number | null): number {
  if (!duration || width <= 0) return 0;
  return clampSeek(((x - left) / width) * duration, duration);
}

/**
 * The turn playing at conversation time `t`: the latest turn that has started (turns sorted by
 * start). In a pause between turns the previous one stays lit; -1 before the first turn.
 */
export function activeTurnIndex(turns: readonly Pick<TranscriptTurn, 'start'>[], t: number): number {
  let lo = 0;
  let hi = turns.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (turns[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** "0:07", "12:40", "1:02:03". */
export function clockTime(seconds: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export const SPEEDS = [1, 1.5, 2] as const;
export type Speed = (typeof SPEEDS)[number];

// ---------- transcript text ----------
export interface TextSegment {
  text: string;
  filler: boolean;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Splits text into plain and filler segments (whole words, case-insensitive, longest first). Rendered as text, never HTML. */
export function splitFillers(text: string, fillers: readonly string[]): TextSegment[] {
  const words = [...new Set(fillers.map((f) => f.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (words.length === 0 || !text) return text ? [{ text, filler: false }] : [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}'’])(${words.map(escapeRe).join('|')})(?![\\p{L}\\p{N}'’])`, 'giu');
  const out: TextSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    if (i > last) out.push({ text: text.slice(last, i), filler: false });
    out.push({ text: m[0], filler: true });
    last = i + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), filler: false });
  return out;
}

export const speakerLabel = (s: TranscriptTurn['speaker']): string => (s === 'me' ? 'You' : 'Them');

/** Plain-text script for the clipboard. */
export function transcriptText(t: Pick<SessionTranscript, 'turns'>, heading?: string): string {
  const lines = t.turns.map((turn) => `${speakerLabel(turn.speaker)} (${clockTime(turn.start)}): ${turn.text.trim()}`);
  return [heading, heading ? '' : null, ...lines].filter((l): l is string => l !== null && l !== undefined).join('\n');
}

export function fillerCount(turns: readonly TranscriptTurn[]): number {
  return turns.reduce((n, t) => n + (t.speaker === 'me' ? splitFillers(t.text, t.fillers).filter((s) => s.filler).length : 0), 0);
}
