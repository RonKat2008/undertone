import type { HapticPattern } from '../../bus/contracts';

export interface PatternInfo {
  pattern: HapticPattern;
  name: string;
  feel: string;
  meaning: string;
  category: 'nudge' | 'status';
  timingLabel: string;
}

export const PATTERN_LIST: PatternInfo[] = [
  // Real-time nudges
  {
    pattern: 'tap',
    name: 'tap',
    feel: '1 light tick',
    meaning: 'Generic cue / acknowledged',
    category: 'nudge',
    timingLabel: '80 ms',
  },
  {
    pattern: 'interrupt',
    name: 'interrupt',
    feel: '2 sharp heavy taps',
    meaning: 'You cut them off → Let them finish',
    category: 'nudge',
    timingLabel: '2 × 50 ms',
  },
  {
    pattern: 'filler',
    name: 'filler',
    feel: '1 short medium',
    meaning: 'Filler word or hedge → Pause',
    category: 'nudge',
    timingLabel: '100 ms',
  },
  {
    pattern: 'wrap_up',
    name: 'wrap_up',
    feel: '3 rising taps',
    meaning: 'Talking too long → Ask a question',
    category: 'nudge',
    timingLabel: '3 × 80 ms',
  },
  {
    pattern: 'slow_down',
    name: 'slow_down',
    feel: 'Long soft ramp',
    meaning: 'Too fast → Slow down',
    category: 'nudge',
    timingLabel: '800 ms ramp',
  },
  {
    pattern: 'still',
    name: 'still',
    feel: '2 soft slow pulses',
    meaning: 'Hands fidgeting → Hands calm',
    category: 'nudge',
    timingLabel: '2 × 300 ms',
  },
  {
    pattern: 'success',
    name: 'success',
    feel: 'Bright double',
    meaning: 'Clear good moment',
    category: 'nudge',
    timingLabel: '80 ms + 80 ms',
  },
  {
    pattern: 'approve',
    name: 'approve',
    feel: '2 selection ticks',
    meaning: 'Pending request waiting for approval',
    category: 'nudge',
    timingLabel: '2 × 50 ms',
  },
  // Status replies ("How am I doing?" single tap on band)
  {
    pattern: 'status_good',
    name: 'status_good',
    feel: '1 slow, even buzz',
    meaning: '"How am I doing?" → Good',
    category: 'status',
    timingLabel: '400 ms buzz',
  },
  {
    pattern: 'status_talking',
    name: 'status_talking',
    feel: '2 slow, even buzzes',
    meaning: '"How am I doing?" → Talking too much',
    category: 'status',
    timingLabel: '2 × 300 ms buzzes',
  },
  {
    pattern: 'status_ask',
    name: 'status_ask',
    feel: '3 slow, even buzzes',
    meaning: '"How am I doing?" → Ask a question',
    category: 'status',
    timingLabel: '3 × 200 ms buzzes',
  },
];
