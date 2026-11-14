/**
 * The conversations library contract (GET /sessions[?include=all], GET /sessions/{id}/transcript,
 * GET /sessions/{id}/audio, POST /sessions/{id}/keep). Mirrors the backend; do not change shapes here.
 */
import type { SessionSummary } from '@/lib/bus/contracts';

export interface TranscriptTurn {
  turn_id: string;
  speaker: 'me' | 'other';
  text: string;
  /** Seconds from the start of the conversation. */
  start: number;
  end: number;
  wpm: number;
  fillers: string[];
}

export interface SessionTranscript {
  session_id: string;
  started_at: string;
  duration_s: number | null;
  /** Backend-relative path (prefix with the backend base URL), or null when no recording was kept. */
  audio_url: string | null;
  /** Position of a turn in the audio = turn.start + audio_offset_s. */
  audio_offset_s: number;
  turns: TranscriptTurn[];
}

/** Why the backend kept, or did not keep, a capture. */
export type KeptReason = 'keep' | 'trivial' | 'noise' | 'sensitive';

/** A SessionSummary with the library fields made explicit. Missing `kept` from the backend means kept. */
export interface LibrarySession extends SessionSummary {
  kept: boolean;
  kept_reason: KeptReason | null;
  audio_url: string | null;
}
