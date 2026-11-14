/**
 * A new debrief arrived: one quiet line at the top of the screen that opens it. Arrives, goes by itself.
 * Tempo (§4.5): sits above the page: `well`, 1 px `ruleStrong`, square, one ink-tinted shadow.
 * Neutral throughout: no pattern hue, because a debrief is not a nudge.
 */
import { useEffect, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DebriefNotice as Notice } from '@/bus/phone-state';
import { T } from './kit';
import { reduceMotionNow } from './motion';
import { C, DUR, EASE, F, S } from './theme';

const SHOW_MS = 12000;

interface Props {
  notice: Notice;
  onOpen: () => void;
  onDismiss: () => void;
}

export function DebriefNotice({ notice, onOpen, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const [fade] = useState(() => new Animated.Value(0));

  useEffect(() => {
    fade.setValue(reduceMotionNow() ? 1 : 0);
    Animated.timing(fade, { toValue: 1, duration: reduceMotionNow() ? 0 : DUR.enter, easing: EASE.enter, useNativeDriver: true }).start();
    const id = setTimeout(onDismiss, SHOW_MS);
    return () => clearTimeout(id);
    // a new notice (new `at`) restarts the timer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice.at]);

  const translateY = fade.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] });
  return (
    <Animated.View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: insets.top + S[2], paddingHorizontal: S[3], opacity: fade, transform: [{ translateY }] }}>
      <View accessibilityLiveRegion="polite" style={{
        flexDirection: 'row', alignItems: 'stretch', backgroundColor: C.well, borderWidth: 1, borderColor: C.ruleStrong,
        // the §4.5 overlay shadow, pointing down
        shadowColor: '#000', shadowOpacity: 0.32, shadowRadius: 16, shadowOffset: { width: 0, height: 4 }, elevation: 6,
      }}>
        <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={notice.headline ? `New debrief. ${notice.headline} Open it.` : 'New debrief. Open it.'}
          style={({ pressed }) => ({ flex: 1, paddingVertical: S[3], paddingLeft: S[4], paddingRight: S[2], opacity: pressed ? 0.6 : 1 })}>
          <T v="label" color={C.fg}>New debrief · open</T>
          {notice.headline ? <T v="small" numberOfLines={2} style={{ marginTop: S[1] }}>{notice.headline}</T> : null}
        </Pressable>
        <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8}
          style={({ pressed }) => ({ width: 48, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: C.rule, backgroundColor: pressed ? C.rule : 'transparent' })}>
          <T v="body" style={{ fontFamily: F.sansMedium }} color={C.fg2}>×</T>
        </Pressable>
      </View>
    </Animated.View>
  );
}
