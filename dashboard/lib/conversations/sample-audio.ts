/**
 * A stand-in recording for sample mode: an 8-bit mono WAV where each turn is a soft hum
 * (lower for them, higher for you) pulsing at a syllable rate, and silence between turns.
 * It lets the player, the scrubber and turn-seeking be tried without a backend. Pure.
 */
import type { TranscriptTurn } from './types';

/** Low, but the hums sit far below Nyquist and a ten-minute sample stays near 2.5 MB. */
export const SAMPLE_RATE = 4000;

export function synthWav(turns: readonly Pick<TranscriptTurn, 'speaker' | 'start' | 'end'>[], totalSeconds: number, offset = 0, rate = SAMPLE_RATE): Uint8Array {
  const n = Math.max(1, Math.round(totalSeconds * rate));
  const out = new Uint8Array(44 + n);
  const view = new DataView(out.buffer);
  const ascii = (at: number, s: string) => { for (let i = 0; i < s.length; i++) out[at + i] = s.charCodeAt(i); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + n, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  ascii(36, 'data'); view.setUint32(40, n, true);
  out.fill(128, 44);
  for (const t of turns) {
    const f = t.speaker === 'me' ? 196 : 147;
    const a = Math.max(0, Math.floor((t.start + offset) * rate));
    const b = Math.min(n, Math.floor((t.end + offset) * rate));
    for (let i = a; i < b; i++) {
      const s = (i - a) / rate;
      const env = Math.min(1, s * 20, (b - i) / rate * 20) * (0.55 + 0.45 * Math.sin(2 * Math.PI * 4.2 * s));
      const v = Math.sin(2 * Math.PI * f * s) * 0.7 + Math.sin(2 * Math.PI * f * 2 * s) * 0.2;
      out[44 + i] = Math.round(128 + 38 * env * v);
    }
  }
  return out;
}
