/**
 * Canned transcripts for the demo feed, so the transcript screen can be seen with no laptop.
 * Always labelled "sample". No recording ships with them (`audio_url: null`).
 *
 *   s-ao-*      the always-on hallway chat (same lines the always-on mock speaks)
 *   otherwise   the scripted case interview the main demo plays (mock-script.ts, which is a
 *               verbatim shared file and does not export its turns, so they are copied here)
 */
import type { SessionSummary } from '@/bus/contracts';
import { AO_LINES } from '@/bus/mock-always-on';
import type { SessionTranscript, TranscriptTurn } from './transcript';

const CASE_TURNS: TranscriptTurn[] = [
  { turn_id: 't01', speaker: 'other', start: 0.6, end: 7.5, wpm: 158, fillers: [],
    text: 'Here’s the case. Our client is a regional coffee chain, about eighty stores. Profits fell twenty percent in two years. Where would you start?' },
  { turn_id: 't02', speaker: 'me', start: 8, end: 13, wpm: 150, fillers: ['um', 'like'],
    text: 'Um, okay. Is the drop across all stores, or, like, just a few of them?' },
  { turn_id: 't03', speaker: 'other', start: 13.6, end: 19.6, wpm: 152, fillers: [],
    text: 'Mostly the newer ones. The stores we opened in the last three years are the ones dragging, and the rent on—' },
  { turn_id: 't04', speaker: 'me', start: 19, end: 27, wpm: 176, fillers: ['basically'],
    text: 'Right, so it’s cannibalisation. The new stores are basically stealing customers from the old ones, and that’s the whole story.' },
  { turn_id: 't05', speaker: 'other', start: 27.8, end: 33.2, wpm: 149, fillers: [],
    text: 'Maybe. I hadn’t finished. Rent on the new sites is also far above plan. What would you want to see next?' },
  { turn_id: 't06', speaker: 'me', start: 33.6, end: 52, wpm: 201, fillers: ['honestly', 'basically'],
    text: 'I’d split it into revenue and cost. On revenue I’d look at same-store sales, then traffic against ticket size, then the mix of drinks and food, and on cost I’d go through rent, labour and beans store by store, and honestly I think you’d find it’s the rent, because if the new sites are in premium locations then the fixed costs are way higher and the volume just isn’t there yet, and that would explain basically everything you’re seeing in the numbers.' },
  { turn_id: 't07', speaker: 'other', start: 52.6, end: 56.2, wpm: 150, fillers: [],
    text: 'That’s a lot. Can you send me that breakdown as one page?' },
  { turn_id: 't08', speaker: 'me', start: 56.6, end: 60.4, wpm: 166, fillers: [],
    text: 'Yes. I’ll send you the deck tonight.' },
];

const CASE_STARTED_AT = '2026-11-14T10:20:00Z';
const CASE_DURATION_S = 63;

/** `known` is the History row for this id, when the demo has one (it carries the real start time). */
export function sampleTranscript(session_id: string, known?: SessionSummary): SessionTranscript {
  if (session_id.startsWith('s-ao-')) {
    const turns = AO_LINES.map((l, i) => ({ turn_id: `${session_id}-t${i + 1}`, ...l }));
    return {
      session_id, started_at: known?.started_at ?? new Date().toISOString(), duration_s: known?.duration_s ?? 21,
      audio_url: null, audio_offset_s: 0, turns,
    };
  }
  return {
    session_id, started_at: known?.started_at ?? CASE_STARTED_AT, duration_s: known?.duration_s ?? CASE_DURATION_S,
    audio_url: null, audio_offset_s: 0, turns: CASE_TURNS,
  };
}
