/**
 * What was actually said in a kept conversation, and where it sits in the recording.
 * Mirrors the backend's GET /sessions/{id}/transcript. Kept here, not in bus/contracts.ts,
 * because that file is a verbatim copy shared with the dashboard.
 *
 * `start`/`end` are seconds from the start of the conversation. A turn's position in the
 * recording is `turn.start + audio_offset_s`.
 */
import type { SessionSummary, Speaker } from '@/bus/contracts';

export interface TranscriptTurn {
  turn_id: string;
  speaker: Speaker;
  text: string;
  start: number;
  end: number;
  wpm: number;
  fillers: string[];
}

export interface SessionTranscript {
  session_id: string;
  started_at: string; // ISO
  duration_s: number | null;
  audio_url: string | null; // backend-relative; resolve with mediaUrl()
  audio_offset_s: number;
  turns: TranscriptTurn[];
}

/** A History row. The kept/recording fields are optional: an older backend omits them, and a missing `kept` means kept. */
export type SessionListItem = SessionSummary & {
  kept?: boolean;
  kept_reason?: string | null;
  audio_url?: string | null;
};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

function parseTurn(v: unknown): TranscriptTurn | null {
  if (!v || typeof v !== 'object') return null;
  const t = v as Record<string, unknown>;
  if (!isStr(t.turn_id) || (t.speaker !== 'me' && t.speaker !== 'other') || !isStr(t.text)) return null;
  if (!isNum(t.start) || !isNum(t.end) || t.end < t.start) return null;
  const fillers = Array.isArray(t.fillers) ? t.fillers.filter(isStr) : [];
  return { turn_id: t.turn_id, speaker: t.speaker, text: t.text, start: t.start, end: t.end, wpm: isNum(t.wpm) ? t.wpm : 0, fillers };
}

/**
 * Runtime shape check. The envelope must be right or the whole reply is rejected (null); a single
 * malformed turn is dropped and counted rather than losing the rest of the conversation.
 */
export function parseTranscript(v: unknown): { transcript: SessionTranscript; dropped: number } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!isStr(o.session_id) || !isStr(o.started_at) || !Array.isArray(o.turns)) return null;
  if (o.duration_s !== null && o.duration_s !== undefined && !isNum(o.duration_s)) return null;
  if (o.audio_url !== null && o.audio_url !== undefined && !isStr(o.audio_url)) return null;
  const turns = o.turns.map(parseTurn).filter((t): t is TranscriptTurn => t !== null).sort((a, b) => a.start - b.start);
  return {
    transcript: {
      session_id: o.session_id,
      started_at: o.started_at,
      duration_s: isNum(o.duration_s) ? o.duration_s : null,
      audio_url: isStr(o.audio_url) && o.audio_url.length > 0 ? o.audio_url : null,
      audio_offset_s: isNum(o.audio_offset_s) ? o.audio_offset_s : 0,
      turns,
    },
    dropped: o.turns.length - turns.length,
  };
}

/** The turn under the playhead: the last one that has started by `t` (conversation seconds). */
export function activeTurnIndex(turns: TranscriptTurn[], t: number): number {
  let found = -1;
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].start <= t + 0.05) found = i;
    else break;
  }
  return found;
}

const WORD_CHAR = /[A-Za-z0-9À-ɏ'’]/;

/** Split text into plain runs and filler-word runs (case-insensitive, whole words). */
export function markFillers(text: string, fillers: string[]): { text: string; filler: boolean }[] {
  const words = [...new Set(fillers.map((f) => f.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (words.length === 0) return [{ text, filler: false }];
  const escaped = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
  // No lookbehind or \p{} escapes: keep to regex features every JS engine the app runs on has.
  const re = new RegExp(`(?:${escaped.join('|')})`, 'gi');
  const out: { text: string; filler: boolean }[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (WORD_CHAR.test(text.charAt(at - 1)) || WORD_CHAR.test(text.charAt(at + m[0].length))) continue; // inside a longer word
    if (at > last) out.push({ text: text.slice(last, at), filler: false });
    out.push({ text: m[0], filler: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), filler: false });
  return out;
}
