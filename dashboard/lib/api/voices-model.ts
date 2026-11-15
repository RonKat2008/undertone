/**
 * Pure shaping for voice memory on the Settings page: backend answers in, plain words out.
 * No fetching here (see voices.ts); unit-tested in voices-model.test.ts.
 */
import { ago } from './settings-model.ts';

export type WearerState = 'none' | 'provisional' | 'confirmed' | 'enrolled';

/** GET /voices/wearer (and VoiceList.wearer). */
export interface WearerVoice {
  state: WearerState;
  has_voiceprint: boolean;
  last_heard: string | null;
}

/** One other person's voice, from VoiceList.voices. Only the fields the page uses. */
export interface KnownVoice {
  voice_id: string;
  name: string;
  named: boolean;
  last_heard: string | null;
  conversations: number;
}

/** GET /voices. */
export interface VoiceList {
  enabled: boolean;
  wearer: WearerVoice;
  voices: KnownVoice[];
}

/** POST /voices/reprocess. */
export interface ReprocessResult {
  queued: number;
  skipped: number;
}

/** How long the wearer speaks for (the backend accepts 6 to 20). */
export const ENROL_SECONDS = 15;

/** A neutral passage to read aloud while enrolling (46 words, about 15 seconds at a calm pace). */
export const ENROL_PASSAGE =
  'The morning light came slowly over the hills, and the town began to wake. A baker opened her shop, ' +
  'a dog crossed the empty square, and somewhere a radio played softly. By nine, the streets were busy, ' +
  'and the day felt ordinary in the best way.';

const STATES: readonly WearerState[] = ['none', 'provisional', 'confirmed', 'enrolled'];
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const optString = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export function parseWearer(v: unknown): WearerVoice | null {
  if (!isObj(v) || typeof v.has_voiceprint !== 'boolean') return null;
  const state = STATES.find((s) => s === v.state);
  if (!state) return null;
  return { state, has_voiceprint: v.has_voiceprint, last_heard: optString(v.last_heard) };
}

function parseKnownVoice(v: unknown): KnownVoice | null {
  if (!isObj(v) || typeof v.voice_id !== 'string' || typeof v.name !== 'string' || typeof v.named !== 'boolean') return null;
  const sessions = Array.isArray(v.sessions) ? v.sessions.filter((s) => typeof s === 'string') : [];
  return { voice_id: v.voice_id, name: v.name.trim() || 'Someone', named: v.named, last_heard: optString(v.last_heard), conversations: sessions.length };
}

/** GET /voices, or null when the body is not a voice list. */
export function parseVoiceList(v: unknown): VoiceList | null {
  if (!isObj(v) || typeof v.enabled !== 'boolean') return null;
  const wearer = parseWearer(v.wearer);
  if (!wearer) return null;
  const raw = v.voices === undefined ? [] : v.voices;
  if (!Array.isArray(raw)) return null;
  const voices = raw.map(parseKnownVoice);
  if (voices.some((x) => x === null)) return null;
  return { enabled: v.enabled, wearer, voices: sortVoices(voices as KnownVoice[]) };
}

export function parseReprocess(v: unknown): ReprocessResult | null {
  if (!isObj(v) || !Array.isArray(v.queued) || !Array.isArray(v.skipped)) return null;
  return { queued: v.queued.length, skipped: v.skipped.length };
}

/** Most recently heard first; never-heard voices last, then by name. */
export function sortVoices(list: readonly KnownVoice[]): KnownVoice[] {
  return [...list].sort((a, b) => {
    if (a.last_heard !== b.last_heard) {
      if (a.last_heard === null) return 1;
      if (b.last_heard === null) return -1;
      return b.last_heard.localeCompare(a.last_heard);
    }
    return a.name.localeCompare(b.name);
  });
}

/** An ISO time as "3 days ago", or null when missing or unreadable. */
export function isoAgo(iso: string | null, nowMs: number = Date.now()): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ago(ms / 1000, nowMs) : null;
}

export type WearerTone = 'quiet' | 'warn' | 'neutral';

export interface WearerWords {
  word: string;
  tone: WearerTone;
  sentence: string;
  /** "Last heard you 3 hours ago.", or null. */
  heard: string | null;
}

const WORDS: Record<WearerState, Omit<WearerWords, 'heard'>> = {
  none: {
    word: 'Not learned yet', tone: 'quiet',
    sentence: 'Undertone doesn’t know your voice yet, so your words can be mixed up with other people’s.',
  },
  provisional: {
    word: 'Guessing', tone: 'warn',
    sentence: 'Undertone is guessing which voice is yours from who sounds closest to the band. Someone louder can be taken for you.',
  },
  confirmed: {
    word: 'Learned from your conversations', tone: 'neutral',
    sentence: 'Undertone picked out your voice over several conversations. Teaching it directly makes it surer.',
  },
  enrolled: {
    word: 'Learned', tone: 'neutral',
    sentence: 'Undertone knows your voice and keeps your words apart from everyone else’s.',
  },
};

export function wearerWords(w: WearerVoice, nowMs: number = Date.now()): WearerWords {
  const when = isoAgo(w.last_heard, nowMs);
  return { ...WORDS[w.state], heard: when ? `Last heard you ${when}.` : null };
}

/** The meta line under another person's voice. */
export function voiceMeta(v: KnownVoice, nowMs: number = Date.now()): string {
  const parts: string[] = [];
  if (!v.named) parts.push('Not named yet');
  const when = isoAgo(v.last_heard, nowMs);
  if (when) parts.push(`last heard ${when}`);
  if (v.conversations > 0) parts.push(v.conversations === 1 ? 'in 1 conversation' : `in ${v.conversations} conversations`);
  if (parts.length === 0) return 'Not heard yet';
  const line = parts.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

/** Why enrolment failed, in plain words, from the answer's status and the backend's message. */
export function enrolFailure(status: number, message: string): string {
  const said = message.toLowerCase();
  if (status === 0) return 'Undertone can’t reach the server on this laptop.';
  if (said.includes('voice memory is off')) return 'Voice memory is turned off on this laptop.';
  if (status === 409) return 'Your band isn’t sending sound. Turn it on, start listening, and try again.';
  if (status === 422) return 'It didn’t hear enough of your voice. Hold the band a little closer and keep talking the whole time.';
  if (status === 503) return 'The voice model isn’t ready on this laptop, so nothing was learned.';
  return 'Nothing was learned. Try again.';
}

/** The toast after "Fix earlier conversations". */
export function reprocessWords(r: ReprocessResult): string {
  if (r.queued === 0) return 'There were no earlier conversations to fix.';
  return r.queued === 1
    ? 'Fixing 1 earlier conversation. It updates in a minute or two.'
    : `Fixing ${r.queued} earlier conversations. They update over the next few minutes.`;
}

/** Seconds left on the countdown (whole, never negative), and whether the speaking time is over. */
export function enrolCountdown(elapsedMs: number, seconds: number = ENROL_SECONDS): { left: number; over: boolean } {
  const left = Math.max(0, Math.ceil(seconds - Math.max(0, elapsedMs) / 1000));
  return { left, over: left === 0 };
}

// ---------- the band, as Calibration needs it ----------

/** The band fields Calibration reads (a subset of BandStatus). */
export interface BandFacts {
  connected: boolean;
  mic_on: boolean;
  always_on: boolean;
}

export type BandReadiness = 'listening' | 'connected' | 'disconnected' | 'none';

/** Whether the band can be calibrated now. null means no band is attached to this laptop. */
export function bandReadiness(band: BandFacts | null): BandReadiness {
  if (band === null) return 'none';
  if (!band.connected) return 'disconnected';
  return band.mic_on || band.always_on ? 'listening' : 'connected';
}

export const BAND_WORDS: Record<BandReadiness, { word: string; tone: 'neutral' | 'warn' | 'quiet'; sentence: string }> = {
  listening: { word: 'Band listening', tone: 'neutral', sentence: 'Your band is connected and sending sound, so you can calibrate now.' },
  connected: { word: 'Band not listening', tone: 'warn', sentence: 'Your band is connected but not sending sound. Double-tap it to start listening.' },
  disconnected: { word: 'Band not connected', tone: 'warn', sentence: 'Turn your band on and keep it near this laptop. Calibration needs it.' },
  none: { word: 'No band', tone: 'quiet', sentence: 'No band is attached to this laptop, so there is nothing to calibrate yet.' },
};

/** A typed name, trimmed and checked against the backend's limit; null when unusable. */
export function cleanName(typed: string): string | null {
  const name = typed.trim().replace(/\s+/g, ' ');
  return name.length > 0 && name.length <= 80 ? name : null;
}
