/** Top of a pushed screen (Debrief, Transcript, Connected apps, Buzz patterns): a back control and a title. */
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { T } from './kit';
import { C, S, TOUCH } from './theme';

function Chevron() {
  return (
    <Svg width={10} height={17} viewBox="0 0 10 17">
      <Path d="M8.5 1.5 1.5 8.5l7 7" stroke={C.text} strokeWidth={2} fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** `title` may be omitted when the screen's first line is its own headline (Debrief). */
export function Header({ title, right, back = 'Back' }: { title?: string; right?: ReactNode; back?: string }) {
  const router = useRouter();
  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
          accessibilityRole="button" accessibilityLabel={back} hitSlop={8}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <Chevron />
          <T v="body">{back}</T>
        </Pressable>
        {right}
      </View>
      {title ? <T v="title" accessibilityRole="header" style={styles.title}>{title}</T> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingBottom: S[4] },
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: TOUCH },
  back: { flexDirection: 'row', alignItems: 'center', gap: S[2], minHeight: TOUCH, paddingRight: S[3] },
  pressed: { opacity: 0.6 },
  title: { marginTop: S[3] },
});
