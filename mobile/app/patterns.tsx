import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import type { HapticPattern } from '@/bus/contracts';
import { PATTERNS, PATTERN_ORDER } from '@/bus/patterns';
import { play } from '@/haptics/player';
import { Header } from '@/ui/Header';
import { Appear, Card, IconWell, Row, Screen, Section, T } from '@/ui/kit';
import { EASE_IN_OUT, useReduceMotion } from '@/ui/motion';
import { PATTERN_WORDS, PatternMark } from '@/ui/Pattern';
import { C, HUES, S, alpha } from '@/ui/theme';

const AFTERGLOW_MS = 300;
const PULSE_HALF_MS = 220;
const PULSE_LOW = 0.35;
/** Matches the card's inner padding so the playing wash runs edge to edge. */
const CARD_INSET = S[4];

const GROUPS: { key: 'nudge' | 'status'; label: string }[] = [
  { key: 'nudge', label: 'Nudges' },
  { key: 'status', label: 'Answers' },
];

/** Nudges cycle through the categorical hues in order; answers share the warm amber. */
function hueOf(p: HapticPattern): string {
  if (PATTERNS[p].group === 'status') return C.warm;
  const nudges = PATTERN_ORDER.filter((x) => PATTERNS[x].group === 'nudge');
  return HUES[Math.max(0, nudges.indexOf(p)) % HUES.length];
}

function PatternRow({ pattern, playing, onPress }: { pattern: HapticPattern; playing: boolean; onPress: () => void }) {
  const reduce = useReduceMotion();
  const glow = useSharedValue(1);
  const hue = hueOf(pattern);
  const words = PATTERN_WORDS[pattern];

  useEffect(() => {
    cancelAnimation(glow);
    if (!playing || reduce) { glow.set(1); return; }
    glow.set(withRepeat(withSequence(
      withTiming(PULSE_LOW, { duration: PULSE_HALF_MS, easing: EASE_IN_OUT }),
      withTiming(1, { duration: PULSE_HALF_MS, easing: EASE_IN_OUT }),
    ), -1, false));
  }, [playing, reduce, glow]);

  const dashes = useAnimatedStyle(() => ({ opacity: glow.get() }));

  return (
    <View style={[styles.wash, playing && { backgroundColor: alpha(hue, 0.14) }]}>
      <Row title={words.say} detail={words.when} onPress={onPress} chevron={false}
        accessibilityLabel={`${words.say}. ${words.when}. Tap to feel it.`}
        leading={<IconWell name="pulse" color={hue} />}
        right={<Animated.View style={dashes}><PatternMark pattern={pattern} color={hue} /></Animated.View>} />
    </View>
  );
}

export default function BuzzPatterns() {
  const [playing, setPlaying] = useState<HapticPattern | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function feel(p: HapticPattern) {
    play(p);
    setPlaying(p);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPlaying(null), PATTERNS[p].total + AFTERGLOW_MS);
  }

  return (
    <Screen>
      <Header title="Buzz patterns" />
      <T v="caption">Tap one to feel it.</T>
      {GROUPS.map((g, gi) => (
        <Section key={g.key} label={g.label}>
          <Appear index={gi}>
            <Card list>
              {PATTERN_ORDER.filter((p) => PATTERNS[p].group === g.key).map((p) => (
                <PatternRow key={p} pattern={p} playing={playing === p} onPress={() => feel(p)} />
              ))}
            </Card>
          </Appear>
        </Section>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  wash: { marginHorizontal: -CARD_INSET, paddingHorizontal: CARD_INSET },
});
