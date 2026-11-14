/**
 * The haptic vocabulary: one spec per HapticPattern. This is the single description of each
 * rhythm; the Glyph component draws it and the phone's player plays it.
 * Shared verbatim between dashboard/lib/bus and mobile/src/bus (edit both, or run scripts/sync-shared.sh).
 */
import type { HapticPattern } from './contracts';

export type Tone = 'ink' | 'vermilion' | 'amber' | 'ochre' | 'blue' | 'violet' | 'green';

/** One pulse. Times in ms from the start of the pattern; level is 0-1. */
export interface Pulse {
  at: number;
  dur: number;
  level: number;
  shape?: 'bar' | 'ramp' | 'soft';
}

export interface PatternSpec {
  pattern: HapticPattern;
  name: string;
  feel: string;
  /** What the wearer should do. An action, never a verdict. */
  action: string;
  tone: Tone;
  pulses: Pulse[];
  /** Length of the whole pattern in ms. */
  total: number;
  group: 'nudge' | 'system' | 'status';
}

function spec(
  pattern: HapticPattern, name: string, feel: string, action: string, tone: Tone,
  group: PatternSpec['group'], pulses: Pulse[],
): PatternSpec {
  const total = Math.max(...pulses.map((p) => p.at + p.dur));
  return { pattern, name, feel, action, tone, group, pulses, total };
}

const SLOW = 420; // "How am I doing?" answers: slow, even, long
const GAP = 300;

export const PATTERNS: Record<HapticPattern, PatternSpec> = {
  slow_down: spec('slow_down', 'Slow down', 'A long soft ramp', 'Slow down', 'blue', 'nudge',
    [{ at: 0, dur: 720, level: 0.85, shape: 'ramp' }]),
  filler: spec('filler', 'Filler', 'One short, medium tap', 'Pause', 'ochre', 'nudge',
    [{ at: 0, dur: 90, level: 0.6 }]),
  interrupt: spec('interrupt', 'Interrupt', 'Two sharp, heavy taps', 'Let them finish', 'vermilion', 'nudge',
    [{ at: 0, dur: 55, level: 1 }, { at: 130, dur: 55, level: 1 }]),
  wrap_up: spec('wrap_up', 'Wrap up', 'Three rising taps', 'Ask a question', 'amber', 'nudge',
    [{ at: 0, dur: 70, level: 0.4 }, { at: 190, dur: 70, level: 0.7 }, { at: 380, dur: 70, level: 1 }]),
  still: spec('still', 'Still', 'Two soft, slow pulses', 'Hands calm', 'violet', 'nudge',
    [{ at: 0, dur: 240, level: 0.35, shape: 'soft' }, { at: 620, dur: 240, level: 0.35, shape: 'soft' }]),
  success: spec('success', 'Success', 'A bright double', 'That worked', 'green', 'nudge',
    [{ at: 0, dur: 60, level: 0.4 }, { at: 150, dur: 80, level: 1 }]),
  tap: spec('tap', 'Tap', 'One light tick', 'Noted', 'ink', 'system',
    [{ at: 0, dur: 45, level: 0.3 }]),
  approve: spec('approve', 'Approve', 'Two tiny ticks', 'Something is waiting for approval', 'ink', 'system',
    [{ at: 0, dur: 28, level: 0.25 }, { at: 120, dur: 28, level: 0.25 }]),
  status_good: spec('status_good', 'One', 'One slow, even buzz', 'You are doing fine', 'ink', 'status',
    [{ at: 0, dur: SLOW, level: 0.6 }]),
  status_talking: spec('status_talking', 'Two', 'Two slow, even buzzes', 'Talking too much', 'ink', 'status',
    [0, 1].map((i) => ({ at: i * (SLOW + GAP), dur: SLOW, level: 0.6 }))),
  status_ask: spec('status_ask', 'Three', 'Three slow, even buzzes', 'Ask a question', 'ink', 'status',
    [0, 1, 2].map((i) => ({ at: i * (SLOW + GAP), dur: SLOW, level: 0.6 }))),
};

export const PATTERN_ORDER: HapticPattern[] = [
  'slow_down', 'filler', 'interrupt', 'wrap_up', 'still', 'success', 'tap', 'approve',
  'status_good', 'status_talking', 'status_ask',
];

export const VERDICT_TEXT: Record<'good' | 'talking_too_much' | 'ask_question', string> = {
  good: 'Good',
  talking_too_much: 'Talking too much',
  ask_question: 'Ask a question',
};

export function isPattern(value: unknown): value is HapticPattern {
  return typeof value === 'string' && value in PATTERNS;
}
