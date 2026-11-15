/**
 * The nudge field: the whole screen turns accent at the instant of the buzz and names it in words.
 * It cuts in (it must match the buzz) and fades out. Touches pass through, so Bookmark still works.
 */
import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T } from '../kit';
import { EASE_OUT, useReduceMotion } from '../motion';
import { C, DUR, GUTTER, S } from '../theme';
import type { Takeover as TakeoverView } from './now-state';

export function Takeover({ take }: { take: TakeoverView }) {
  const insets = useSafeAreaInsets();
  const reduce = useReduceMotion();
  return (
    <Animated.View key={take.key} pointerEvents="none" exiting={reduce ? undefined : FadeOut.duration(DUR.exit).easing(EASE_OUT)}
      style={[styles.field, { paddingTop: insets.top + S[9] }]}
      accessibilityLiveRegion="assertive" accessibilityLabel={take.line ? `${take.word}. ${take.line}` : take.word}>
      <View>
        <T v="display" color={C.onAccent}>{take.word}</T>
        {take.line ? <T v="body" color={C.onAccent} style={styles.line}>{take.line}</T> : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  field: { ...StyleSheet.absoluteFill, backgroundColor: C.accent, paddingHorizontal: GUTTER },
  line: { marginTop: S[2], opacity: 0.8 },
});
