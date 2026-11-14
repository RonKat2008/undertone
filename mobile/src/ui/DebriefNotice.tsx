/** A new debrief arrived: one quiet line at the top of the screen that opens it. Fades in, goes by itself. */
import { useEffect, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DebriefNotice as Notice } from '@/bus/phone-state';
import { T } from './kit';
import { C, F } from './theme';

const SHOW_MS = 12000;
const FADE_MS = 260;

interface Props {
  notice: Notice;
  onOpen: () => void;
  onDismiss: () => void;
}

export function DebriefNotice({ notice, onOpen, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const [fade] = useState(() => new Animated.Value(0));

  useEffect(() => {
    fade.setValue(0);
    Animated.timing(fade, { toValue: 1, duration: FADE_MS, useNativeDriver: true }).start();
    const id = setTimeout(onDismiss, SHOW_MS);
    return () => clearTimeout(id);
    // a new notice (new `at`) restarts the timer
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice.at]);

  const translateY = fade.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] });
  return (
    <Animated.View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: insets.top + 6, paddingHorizontal: 12, opacity: fade, transform: [{ translateY }] }}>
      <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', alignItems: 'stretch', backgroundColor: C.well, borderWidth: 1, borderColor: C.paper, borderRadius: 3, shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 6 }}>
        <Pressable onPress={onOpen} accessibilityRole="button" accessibilityLabel={notice.headline ? `New debrief. ${notice.headline} Open it.` : 'New debrief. Open it.'}
          style={({ pressed }) => ({ flex: 1, paddingVertical: 11, paddingLeft: 14, paddingRight: 8, opacity: pressed ? 0.6 : 1 })}>
          <T v="caps" color={C.paper}>New debrief · open</T>
          {notice.headline ? <T v="small" numberOfLines={2} color={C.paper2} style={{ marginTop: 3 }}>{notice.headline}</T> : null}
        </Pressable>
        <Pressable onPress={onDismiss} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8}
          style={({ pressed }) => ({ width: 44, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderLeftColor: C.rule, opacity: pressed ? 0.5 : 1 })}>
          <T v="body" style={{ fontFamily: F.sansMedium }} color={C.paper2}>×</T>
        </Pressable>
      </View>
    </Animated.View>
  );
}
