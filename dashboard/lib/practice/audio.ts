/**
 * Pure audio helpers for spoken practice: microphone resampling to 16 kHz Int16, chunking,
 * coach-voice decoding (24 kHz Int16 to float), playback scheduling, audio level and the
 * practice socket address. No Web Audio objects here; tested in audio.test.ts.
 */

/** What the backend expects from the microphone (contracts/events.ts). */
export const MIC_RATE = 16_000;
/** What the backend sends for the coach's voice. */
export const COACH_RATE = 24_000;
/** Microphone chunk size: 80 ms at 16 kHz. */
export const MIC_CHUNK_SAMPLES = 1280;

/** The practice socket on the same backend as the REST calls: http -> ws, https -> wss. */
export function practiceSocketUrl(apiBase: string): string {
  const base = apiBase.trim().replace(/\/+$/, '');
  if (/^https:\/\//i.test(base)) return `wss://${base.slice(8)}/ws/practice`;
  if (/^http:\/\//i.test(base)) return `ws://${base.slice(7)}/ws/practice`;
  if (/^wss?:\/\//i.test(base)) return `${base}/ws/practice`;
  return `ws://${base}/ws/practice`;
}

export interface ResampleState {
  /** The last input sample of the previous chunk (index -1 of the next one). */
  readonly carry: number;
  /** Where the next output sample falls, in input samples from the start of the next chunk (-1 <= phase). */
  readonly phase: number;
}

export const RESAMPLE_START: ResampleState = { carry: 0, phase: 0 };

/**
 * Linear-interpolation resampling across chunk boundaries. `ratio` is inRate / outRate
 * (3 for 48 kHz -> 16 kHz). The state carries over, so chunks join without clicks or drift.
 */
export function resampleChunk(input: Float32Array, ratio: number, state: ResampleState): { out: Float32Array; state: ResampleState } {
  const n = input.length;
  if (n === 0 || !(ratio > 0)) return { out: new Float32Array(0), state };
  const out: number[] = [];
  let t = state.phase;
  for (; t <= n - 1; t += ratio) {
    const i0 = Math.floor(t);
    const frac = t - i0;
    const s0 = i0 < 0 ? state.carry : input[i0];
    const s1 = i0 + 1 < n ? input[i0 + 1] : s0;
    out.push(s0 + (s1 - s0) * frac);
  }
  return { out: Float32Array.from(out), state: { carry: input[n - 1], phase: t - n } };
}

/** Float samples (-1..1) to linear16. Out-of-range values clip. */
export function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, Number.isFinite(input[i]) ? input[i] : 0));
    out[i] = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
  }
  return out;
}

/** Little-endian linear16 bytes to float samples. A trailing odd byte is ignored. */
export function int16BytesToFloat(bytes: ArrayBuffer): Float32Array {
  const view = new DataView(bytes);
  const count = Math.floor(bytes.byteLength / 2);
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) out[i] = view.getInt16(i * 2, true) / 0x8000;
  return out;
}

/** Append samples and cut off every full chunk; the remainder waits for more. */
export function splitChunks(pending: Int16Array, add: Int16Array, size: number = MIC_CHUNK_SAMPLES): { chunks: Int16Array[]; pending: Int16Array } {
  const all = new Int16Array(pending.length + add.length);
  all.set(pending, 0);
  all.set(add, pending.length);
  const chunks: Int16Array[] = [];
  let at = 0;
  for (; at + size <= all.length; at += size) chunks.push(all.slice(at, at + size));
  return { chunks, pending: all.slice(at) };
}

/** Small lead before the first chunk of an utterance, so playback starts cleanly. */
export const PLAYBACK_LEAD_S = 0.04;

/** When the next coach chunk should start: right after the queue, or a moment from now when the queue is empty. */
export function nextStartTime(now: number, queueEnd: number): number {
  return queueEnd > now ? queueEnd : now + PLAYBACK_LEAD_S;
}

/** How long to wait after the queue empties, while the coach still "speaks", before calling it finished. */
export const DRAIN_GRACE_MS = 700;

export interface DrainInputs {
  /** Coach audio arrived since the last playback_done (or barge-in). */
  pending: boolean;
  /** Sources still scheduled or playing. */
  playing: number;
  /** The speaker the backend last reported. */
  speaker: string;
}

/**
 * Whether the coach's utterance has finished playing: 'now' to send playback_done, 'wait' to
 * give late chunks a short grace (the backend still says the coach is speaking), or 'no'.
 */
export function drainDecision({ pending, playing, speaker }: DrainInputs): 'now' | 'wait' | 'no' {
  if (!pending || playing > 0) return 'no';
  return speaker === 'coach' ? 'wait' : 'now';
}

/** Loudness 0-1 from time-domain samples: RMS, lifted so speech fills the range. */
export function levelOf(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, Math.sqrt(rms) * 1.8);
}

/** Ease a displayed level toward the measured one: fast up, slower down. */
export function smoothLevel(shown: number, measured: number): number {
  const k = measured > shown ? 0.45 : 0.12;
  return shown + (measured - shown) * k;
}
