/**
 * Haptic patterns in plain words. The buzz itself is the interface; the screen only names it.
 * Where a mark helps (the pattern tester), short and long dashes match the buzz: no notation.
 */
import { StyleSheet, View } from 'react-native';
import type { HapticPattern } from '@/bus/contracts';
import { PATTERNS } from '@/bus/patterns';
import { C } from './theme';

interface Words {
  /** What to do, as the wearer reads it mid-conversation. */
  say: string;
  /** When it buzzes, one short line. */
  when: string;
}

export const PATTERN_WORDS: Record<HapticPattern, Words> = {
  slow_down: { say: 'Slow down', when: 'You’re speaking faster than usual' },
  filler: { say: 'Pause', when: 'A filler word slipped in' },
  interrupt: { say: 'Let them finish', when: 'You started while they were talking' },
  wrap_up: { say: 'Wrap up', when: 'You’ve been talking a while' },
  still: { say: 'Hands still', when: 'Your hands are restless' },
  success: { say: 'That worked', when: 'A good moment' },
  tap: { say: 'Noted', when: 'Something was saved' },
  approve: { say: 'Approval waiting', when: 'An app wants to buzz you' },
  status_good: { say: 'Doing fine', when: 'One slow buzz' },
  status_talking: { say: 'Talking a lot', when: 'Two slow buzzes' },
  status_ask: { say: 'Ask a question', when: 'Three slow buzzes' },
};

/** The plain word for a pattern; a safe fallback for anything unknown. */
export function patternWord(pattern: HapticPattern | null | undefined): string {
  return pattern && PATTERN_WORDS[pattern] ? PATTERN_WORDS[pattern].say : 'Buzz';
}

const LONG_MS = 150;

/** Short and long dashes, one per pulse, in order. Decorative: the words carry the meaning. */
export function PatternMark({ pattern, color = C.muted }: { pattern: HapticPattern; color?: string }) {
  const spec = PATTERNS[pattern];
  if (!spec) return null;
  return (
    <View style={styles.row} aria-hidden>
      {spec.pulses.map((p, i) => (
        <View key={i} style={[styles.dash, p.dur >= LONG_MS ? styles.long : styles.short, { backgroundColor: color }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dash: { height: 4, borderRadius: 2 },
  short: { width: 8 },
  long: { width: 26 },
});
