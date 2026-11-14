import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, FONTS } from '../../theme/tokens';

interface PatternHeaderProps {
  activeCount?: number;
}

export function PatternHeader({ activeCount = 0 }: PatternHeaderProps) {
  const router = useRouter();

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <View style={styles.container}>
      {/* Top Navigation Bar */}
      <View style={styles.navBar}>
        <Pressable
          onPress={handleBack}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={({ pressed }) => [styles.backButton, pressed && styles.buttonPressed]}>
          <Text style={styles.backButtonText}>← BACK</Text>
        </Pressable>

        <View style={styles.counterBadge}>
          <Text style={styles.counterText}>
            {activeCount > 0 ? `${activeCount} ACTIVE` : '11 PATTERNS'}
          </Text>
        </View>
      </View>

      {/* Editorial Title Section */}
      <View style={styles.titleSection}>
        <Text style={styles.eyebrow}>HAPTIC NOTATION · METRONOME</Text>
        <Text style={styles.displayTitle}>Pattern Tester</Text>
        <Text style={styles.description}>
          Every pattern maps rhythm to physical layout. Width is duration, height is intensity,
          and gaps represent silence between taps. Tap any row to trigger its sequence.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.ink,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  backButton: {
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 4,
  },
  buttonPressed: {
    backgroundColor: COLORS.surface,
  },
  backButtonText: {
    fontFamily: FONTS.monoMedium,
    fontSize: 12,
    color: COLORS.paper,
    letterSpacing: 0.8,
  },
  counterBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 3,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairline,
  },
  counterText: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    color: COLORS.inkMid,
    letterSpacing: 0.5,
  },
  titleSection: {
    gap: 6,
  },
  eyebrow: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.other,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  displayTitle: {
    fontFamily: FONTS.display,
    fontSize: 38,
    lineHeight: 42,
    color: COLORS.paper,
    letterSpacing: -0.5,
  },
  description: {
    fontFamily: FONTS.ui,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.inkMid,
    marginTop: 4,
  },
});
