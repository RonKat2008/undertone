/**
 * Pure shaping for the Home page: backend answers (reports overview, people by relationship,
 * sessions) checked at the boundary and turned into what Home shows. No fetch, no React;
 * tested in home-model.test.ts. Nothing here invents a number: a missing value stays missing
 * and the screen hides that line.
 */
import type { SessionSummary } from '../bus/contracts';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);

// ---------- reports overview ----------
export interface WeekTotals {
  conversations: number;
  /** Minutes of conversation heard (you and them together). */
  minutesTogether: number | null;
  nudges: number | null;
}

export interface Ranked {
  /** Graph node id, e.g. "person:alex" or "topic:vendor-api"; links into Insights. */
  nodeId: string;
  label: string;
  conversations: number;
  minutes: number;
}

export interface Overview {
  totals: WeekTotals;
  /** Plain sentences the backend wrote from real numbers; empty when there is too little to say. */
  highlights: string[];
  topPeople: Ranked[];
  topTopics: Ranked[];
  /** Conversations per day, oldest first, for a word-sized trend. */
  perDay: number[];
  insufficient: boolean;
}

function ranked(v: unknown): Ranked[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((r) => {
    if (!isObj(r)) return [];
    const nodeId = str(r.node_id);
    const label = str(r.label);
    if (!nodeId || !label) return [];
    return [{ nodeId, label, conversations: num(r.conversations) ?? 0, minutes: num(r.minutes) ?? 0 }];
  });
}

/** GET /reports/overview body -> Overview, or null when the shape is wrong. */
export function parseOverview(body: unknown): Overview | null {
  if (!isObj(body) || !isObj(body.totals)) return null;
  const t = body.totals;
  const conversations = num(t.conversations);
  if (conversations === null) return null;
  const insufficient = body.insufficient_data === true;
  const highlights = Array.isArray(body.highlights)
    ? body.highlights.flatMap((h) => (isObj(h) && h.kind !== 'insufficient_data' && str(h.text) ? [String(h.text)] : []))
    : [];
  const perDay = Array.isArray(body.series)
    ? body.series.flatMap((d) => (isObj(d) && num(d.conversations) !== null ? [Number(d.conversations)] : []))
    : [];
  return {
    totals: { conversations, minutesTogether: num(t.minutes_together), nudges: num(t.nudges) },
    highlights,
    topPeople: ranked(body.top_people),
    topTopics: ranked(body.top_topics),
    perDay,
    insufficient,
  };
}

// ---------- people ----------
export interface HomePerson {
  personId: string;
  name: string;
  /** "friend", "coworker"...; null when the coach has not worked it out. */
  relationship: string | null;
  conversations: number;
  /** Unix seconds. */
  lastTalked: number | null;
  /** One line for next time ("Follow up: ask Priya how ..."), when the coach has one. */
  hint: string | null;
}

const UNKNOWN_RELATIONSHIPS = new Set(['unknown', 'other', 'none', '']);

/** GET /reports/by-person body (+ the briefs from GET /people) -> people, most talked-with first. */
export function parsePeople(body: unknown, briefs: ReadonlyMap<string, string> = new Map()): HomePerson[] | null {
  if (!isObj(body) || !Array.isArray(body.people)) return null;
  const people = body.people.flatMap((p): HomePerson[] => {
    if (!isObj(p)) return [];
    const personId = str(p.person_id);
    const name = str(p.name);
    if (!personId || !name) return [];
    const rel = str(p.relationship);
    return [{
      personId,
      name,
      relationship: rel && !UNKNOWN_RELATIONSHIPS.has(rel.toLowerCase()) ? rel.toLowerCase() : null,
      conversations: num(p.conversations) ?? 0,
      lastTalked: num(p.last_talked),
      hint: nextTimeHint(briefs.get(personId) ?? null),
    }];
  });
  return [...people].sort((a, b) => b.conversations - a.conversations || (b.lastTalked ?? 0) - (a.lastTalked ?? 0));
}

/**
 * The forward-looking part of a person's brief. Briefs read like "Last time you talked 55%. Follow up:
 * ask Alex how the Lisbon trip went."; the percentage sentence is dropped (no scores on screen).
 */
export function nextTimeHint(brief: string | null): string | null {
  if (!brief) return null;
  const sentences = brief.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const kept = sentences.filter((s) => !/\d\s*%/.test(s));
  if (kept.length === 0) return null;
  return kept.join(' ').replace(/^Follow up:\s*/i, '').replace(/^\w/, (c) => c.toUpperCase());
}

// ---------- sessions ----------
/**
 * Newest first, practice rounds left out (Home is about real conversations), and the conversation
 * still in progress left out: it has no debrief yet.
 */
export function newestConversations(sessions: readonly SessionSummary[], inProgressId: string | null = null): SessionSummary[] {
  return sessions
    .filter((s) => s.mode !== 'practice' && s.session_id !== inProgressId)
    .slice()
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
}

/** "just now", "12 minutes ago", "yesterday", "3 days ago", or a date. */
export function relativeWhen(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.round((now - t) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : `${hours} hours ago`;
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const days = Math.ceil((startOfToday.getTime() - t) / 86400000);
  if (days <= 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long' });
}

/** "11 minutes" / "under a minute". */
export function durationWords(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 60) return 'under a minute';
  const m = Math.round(seconds / 60);
  return m === 1 ? '1 minute' : `${m} minutes`;
}

/** Talk share in words, never a percentage. */
export function shareWords(share: number, name: string): string {
  if (share >= 0.65) return `You did most of the talking with ${name}`;
  if (share >= 0.55) return `You talked a little more than ${name}`;
  if (share > 0.45) return `You and ${name} talked about evenly`;
  if (share > 0.35) return `${name} talked a little more than you`;
  return `${name} did most of the talking`;
}

/** The pace band Home draws (words a minute): a conversational range, not a judgement of you. */
export const PACE_RANGE: [number, number] = [100, 220];
export const PACE_ZONE: [number, number] = [130, 170];

export function paceWords(wpm: number): string {
  if (wpm > PACE_ZONE[1] + 15) return 'Fast';
  if (wpm > PACE_ZONE[1]) return 'A little fast';
  if (wpm < PACE_ZONE[0] - 15) return 'Slow';
  if (wpm < PACE_ZONE[0]) return 'A little slow';
  return 'An easy pace';
}

// ---------- the hero ----------
export type HeroState = 'connecting' | 'unreachable' | 'disconnected' | 'conversation' | 'listening' | 'ready';

export interface HeroInputs {
  busStatus: 'mock' | 'connecting' | 'live' | 'offline';
  bandConnected: boolean | null;
  micOn: boolean;
  alwaysOn: boolean | null;
  inSession: boolean;
}

export function heroState({ busStatus, bandConnected, micOn, alwaysOn, inSession }: HeroInputs): HeroState {
  if (busStatus === 'offline') return 'unreachable';
  if (busStatus === 'connecting' && bandConnected === null) return 'connecting';
  if (inSession) return 'conversation';
  if (!bandConnected) return 'disconnected';
  if (micOn || alwaysOn === true) return 'listening';
  return 'ready';
}

export const HERO_HEADLINE: Record<HeroState, string> = {
  connecting: 'Finding your band.',
  unreachable: 'Can’t reach your laptop.',
  disconnected: 'Your band isn’t connected.',
  conversation: 'You’re in a conversation.',
  listening: 'Listening.',
  ready: 'Your band is ready.',
};

export const HERO_LINE: Record<HeroState, string> = {
  connecting: 'One moment while Undertone looks for your laptop and band.',
  unreachable: 'Undertone runs on your laptop. Open it and check it’s awake; this page will catch up by itself.',
  disconnected: 'Put your band on and switch it on. Undertone will pick it up by itself.',
  conversation: 'Talk as you normally would. Your phone buzzes only when a nudge would help.',
  listening: 'Talk as you normally would. After each conversation your coach writes you a short debrief.',
  ready: 'It’s on your wrist and connected. It starts listening when a conversation begins.',
};
