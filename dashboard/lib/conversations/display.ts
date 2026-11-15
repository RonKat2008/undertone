/**
 * Plain-words display helpers for the Conversations list and the conversation page: hidden
 * reasons, "when" and "how long", transcript timestamps, the coach's flagged moments, and the
 * numbers said as sentences. Pure; tested in display.test.ts. Builds on model.ts, unchanged.
 */
import type { BookmarkReview, Debrief } from '../bus/contracts';
import { activeTurnIndex, dayKey, longDate, relativeDayName, splitFillers, timeOfDay } from './model.ts';
import type { LibrarySession, TranscriptTurn } from './types';

// ---------- hidden, in plain words ----------
/** Why a conversation is hidden: "Too short", "Just noise", "Private", "Hidden by you"; null when shown. */
export function hiddenReason(s: Pick<LibrarySession, 'kept' | 'kept_reason'>): string | null {
  if (s.kept) return null;
  if (s.kept_reason === 'trivial') return 'Too short';
  if (s.kept_reason === 'noise') return 'Just noise';
  if (s.kept_reason === 'sensitive') return 'Private';
  return 'Hidden by you';
}

// ---------- when and how long ----------
/** A day heading: "Today", "Yesterday", or "Wednesday 11 November". */
export function dayHeading(key: string, todayKey: string): string {
  return relativeDayName(key, todayKey) ?? longDate(key, todayKey);
}

/** "Today, 11:30", "Yesterday, 09:45", "Friday 13 November, 11:30". `offsetMin` as Date#getTimezoneOffset. */
export function whenLabel(iso: string, nowIso: string, offsetMin?: number): string {
  const day = dayKey(iso, offsetMin ?? new Date(iso).getTimezoneOffset());
  const today = dayKey(nowIso, offsetMin ?? new Date(nowIso).getTimezoneOffset());
  return `${dayHeading(day, today)}, ${timeOfDay(iso, offsetMin ?? new Date(iso).getTimezoneOffset())}`;
}

/** "40 sec", "11 min", "1 h 5 min". */
export function lengthLabel(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} sec`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** The backend writes this placeholder headline while a conversation is still going. */
export const IN_PROGRESS_HEADLINE = '(in progress)';

/** A headline worth showing, or null ("No debrief for this one" is the screen's job). */
export function shownHeadline(headline: string | null | undefined): string | null {
  const h = (headline ?? '').trim();
  return h && h !== IN_PROGRESS_HEADLINE ? h : null;
}

// ---------- transcript ----------
/** A pause this long (seconds) between turns earns a fresh timestamp even without a change of speaker. */
export const LONG_GAP_S = 20;

export interface TurnRow {
  turn: TranscriptTurn;
  index: number;
  /** The speaker changed: show the name. */
  newSpeaker: boolean;
  /** Show the time: a change of speaker or a long gap. */
  showTime: boolean;
}

export function transcriptRows(turns: readonly TranscriptTurn[], gapS: number = LONG_GAP_S): TurnRow[] {
  return turns.map((turn, index) => {
    const prev = index > 0 ? turns[index - 1] : null;
    const newSpeaker = !prev || prev.speaker !== turn.speaker;
    const gap = prev ? turn.start - Math.max(prev.end, prev.start) : 0;
    return { turn, index, newSpeaker, showTime: newSpeaker || gap >= gapS };
  });
}

/** Unambiguous hesitation sounds, marked even when the backend sent no filler list for a turn. */
const HESITATIONS = ['um', 'uh', 'erm', 'uhm'];

/** The filler words to mark in one of your turns; the other person's words are never marked. */
export function fillersFor(turn: Pick<TranscriptTurn, 'speaker' | 'fillers'>): string[] {
  if (turn.speaker !== 'me') return [];
  return turn.fillers.length > 0 ? turn.fillers : HESITATIONS;
}

/** A moment the coach pointed at: the turn, the exact words when they can be found, and why. */
export interface FlaggedMoment {
  turnIndex: number;
  phrase: string | null;
  why: string;
}

function bookmarkWhy(b: BookmarkReview): string {
  const said = b.what_happened.trim() || (b.source === 'promise' ? 'You made a promise here.' : 'You marked this moment.');
  return b.follow_up ? `${said} Follow up: ${b.follow_up.trim()}` : said;
}

const findIn = (text: string, phrase: string): number => (phrase ? text.toLowerCase().indexOf(phrase.toLowerCase()) : -1);

/** The debrief's bookmarks and best moment, placed on transcript turns. One flag per turn, first wins. */
export function flaggedMoments(turns: readonly TranscriptTurn[], d: Pick<Debrief, 'bookmarks' | 'best_moment_quote'> | null): FlaggedMoment[] {
  if (!d || turns.length === 0) return [];
  const out: FlaggedMoment[] = [];
  const taken = new Set<number>();
  const add = (turnIndex: number, phrase: string, why: string) => {
    if (turnIndex < 0 || taken.has(turnIndex)) return;
    taken.add(turnIndex);
    const at = findIn(turns[turnIndex].text, phrase.trim());
    out.push({ turnIndex, phrase: at >= 0 ? turns[turnIndex].text.slice(at, at + phrase.trim().length) : null, why });
  };
  for (const b of d.bookmarks ?? []) {
    const bySnippet = b.snippet ? turns.findIndex((t) => findIn(t.text, b.snippet.trim()) >= 0) : -1;
    add(bySnippet >= 0 ? bySnippet : activeTurnIndex(turns, b.ts), b.snippet ?? '', bookmarkWhy(b));
  }
  const quote = (d.best_moment_quote ?? '').trim().replace(/^["“]|["”]$/g, '');
  if (quote) add(turns.findIndex((t) => findIn(t.text, quote) >= 0), quote, 'Your best moment in this conversation.');
  return out.sort((a, b) => a.turnIndex - b.turnIndex);
}

export interface Piece {
  text: string;
  filler: boolean;
  flagged: boolean;
}

/** A turn's text in pieces: the flagged phrase (if any) and filler words, for rendering as text. */
export function turnPieces(text: string, fillers: readonly string[], flagPhrase: string | null): Piece[] {
  const at = flagPhrase ? text.indexOf(flagPhrase) : -1;
  const parts = at >= 0
    ? [{ t: text.slice(0, at), f: false }, { t: flagPhrase as string, f: true }, { t: text.slice(at + (flagPhrase as string).length), f: false }]
    : [{ t: text, f: false }];
  return parts.flatMap((p) => splitFillers(p.t, fillers).map((s) => ({ text: s.text, filler: s.filler, flagged: p.f })));
}

// ---------- the numbers, said in sentences ----------
/** "You did about half the talking with Priya." */
export function talkShareWords(share: number, other: string | null): string {
  const them = other ?? 'them';
  if (!Number.isFinite(share)) return '';
  if (share >= 0.65) return `You did most of the talking${other ? ` with ${other}` : ''}.`;
  if (share >= 0.55) return `You talked a little more than ${them}.`;
  if (share > 0.45) return `You and ${them} shared the talking about evenly.`;
  if (share > 0.35) return `${other ?? 'They'} talked a little more than you.`;
  return `${other ?? 'They'} did most of the talking.`;
}

/** The comfortable pace zone: your usual pace give or take 15%, or a common range when unknown. */
export function paceZone(usual: number | null): [number, number] {
  return usual && usual > 0 ? [Math.round(usual * 0.85), Math.round(usual * 1.15)] : [130, 170];
}

/** "You spoke at about 154 words a minute, right in your comfortable range." */
export function paceWords(wpm: number, usual: number | null): string {
  const [lo, hi] = paceZone(usual);
  const where = wpm > hi * 1.12 ? 'quite a bit faster than is comfortable for you'
    : wpm > hi ? 'a little faster than your comfortable range'
      : wpm < lo * 0.88 ? 'slower than usual'
        : wpm < lo ? 'a little slower than your comfortable range'
          : 'right in your comfortable range';
  return `You spoke at about ${Math.round(wpm)} words a minute, ${where}.`;
}

/** "You used 12 filler words, about 4 a minute." Counts what was marked, else estimates from the rate. */
export function fillerWords(marked: number, perMinute: number, durationS: number | null): string {
  const rate = Number.isFinite(perMinute) ? perMinute : 0;
  const count = marked > 0 ? marked : Math.round(rate * (durationS ?? 0) / 60);
  if (count <= 0 && rate <= 0) return 'You used almost no filler words.';
  const perMin = rate >= 1 ? `, about ${Math.round(rate)} a minute` : rate > 0 ? ', fewer than one a minute' : '';
  return `You used ${count === 1 ? 'one filler word' : `${count} filler words`}${perMin}.`;
}

const times = (n: number, one: string, many: string) => (n === 0 ? `no ${many}` : n === 1 ? `one ${one}` : `${n} ${many}`);

/** "You asked 4 questions and cut in once." */
export function questionsWords(questions: number, interruptions: number): string {
  const q = Math.max(0, Math.round(questions));
  const i = Math.max(0, Math.round(interruptions));
  const cut = i === 0 ? 'never cut in' : i === 1 ? 'cut in once' : i === 2 ? 'cut in twice' : `cut in ${i} times`;
  return `You asked ${times(q, 'question', 'questions')} and ${cut}.`;
}

// ---------- following the playing turn without fighting the reader ----------
/** After the reader scrolls by hand, leave the page alone for this long. */
export const HAND_SCROLL_QUIET_MS = 4000;

export function shouldFollow(lastHandScrollAt: number, now: number, quietMs: number = HAND_SCROLL_QUIET_MS): boolean {
  return now - lastHandScrollAt >= quietMs;
}

/** True when an element's box is outside the comfortable band [top, bottom] of the viewport. */
export function outOfView(rect: { top: number; bottom: number }, top: number, bottom: number): boolean {
  return rect.top < top || rect.bottom > bottom;
}

// ---------- tagging a person ----------
export interface PersonChoice {
  person_id: string;
  name: string;
}

/** People whose names contain every typed word, best first (starts-with before contains). */
export function matchPeople<T extends PersonChoice>(people: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...people];
  const words = q.split(/\s+/);
  const hits = people.filter((p) => words.every((w) => p.name.toLowerCase().includes(w)));
  return hits.sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)));
}

/** Whether a typed name is new (no one by that exact name yet), so "Add" should be offered. */
export function isNewName(people: readonly PersonChoice[], query: string): boolean {
  const q = query.trim().toLowerCase();
  return q.length > 0 && !people.some((p) => p.name.trim().toLowerCase() === q);
}
