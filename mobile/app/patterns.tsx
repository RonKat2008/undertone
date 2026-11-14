import React, { useState, useRef, useEffect, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, FONTS } from '../src/theme/tokens';
import type { HapticPattern } from '../src/bus/contracts';
import { play } from '../src/haptics/player';
import {
  PATTERN_LIST,
  PatternRow,
  PatternHeader,
  PatternSectionDivider,
  PatternInfo,
} from '../src/components/patterns';

export default function PatternsScreen() {
  const [playingMap, setPlayingMap] = useState<Partial<Record<HapticPattern, boolean>>>({});
  const timeoutRefs = useRef<Partial<Record<HapticPattern, ReturnType<typeof setTimeout>>>>({});

  const handlePlayPattern = useCallback((pattern: HapticPattern) => {
    // 1. Invoke haptic player (no-op stub in development)
    play(pattern);

    // 2. Clear any existing timer for this pattern
    if (timeoutRefs.current[pattern]) {
      clearTimeout(timeoutRefs.current[pattern]);
    }

    // 3. Mark pattern as playing
    setPlayingMap((prev) => ({ ...prev, [pattern]: true }));

    // 4. Reset after ~1.5s (1500 ms)
    timeoutRefs.current[pattern] = setTimeout(() => {
      setPlayingMap((prev) => ({ ...prev, [pattern]: false }));
      delete timeoutRefs.current[pattern];
    }, 1500);
  }, []);

  // Cleanup timeouts on unmount
  useEffect(() => {
    return () => {
      Object.values(timeoutRefs.current).forEach((timer) => {
        if (timer) clearTimeout(timer);
      });
    };
  }, []);

  const activeCount = Object.values(playingMap).filter(Boolean).length;
  const nudgePatterns = PATTERN_LIST.filter((p) => p.category === 'nudge');
  const statusPatterns = PATTERN_LIST.filter((p) => p.category === 'status');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}>
        {/* Screen Header */}
        <PatternHeader activeCount={activeCount} />

        {/* Section 1: Real-time Nudges */}
        <PatternSectionDivider
          title="Conversation Nudges"
          count={nudgePatterns.length}
          subtitle="Real-time vibrational cues sent during conversations"
        />
        {nudgePatterns.map((item: PatternInfo) => (
          <PatternRow
            key={item.pattern}
            item={item}
            playing={!!playingMap[item.pattern]}
            onPress={() => handlePlayPattern(item.pattern)}
          />
        ))}

        {/* Section 2: Status Query Replies */}
        <PatternSectionDivider
          title="Status Replies"
          count={statusPatterns.length}
          subtitle="Responses to a single band tap: 'How am I doing?'"
        />
        {statusPatterns.map((item: PatternInfo) => (
          <PatternRow
            key={item.pattern}
            item={item}
            playing={!!playingMap[item.pattern]}
            onPress={() => handlePlayPattern(item.pattern)}
          />
        ))}

        {/* Technical Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerLabel}>SYSTEM / HAPTIC METRONOME</Text>
          <Text style={styles.footerText}>
            Tested against Undertone contracts spec. Each glyph visualizes relative duration,
            amplitude, and inter-pulse timing.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.ink,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.ink,
  },
  contentContainer: {
    paddingBottom: 48,
  },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 24,
    backgroundColor: COLORS.ink,
    borderTopWidth: 1,
    borderTopColor: COLORS.hairline,
    gap: 6,
  },
  footerLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.other,
    letterSpacing: 1,
  },
  footerText: {
    fontFamily: FONTS.ui,
    fontSize: 12,
    lineHeight: 16,
    color: COLORS.inkMid,
  },
});
