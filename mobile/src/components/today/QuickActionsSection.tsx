import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';

export function QuickActionsSection() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.sectionLabel}>ACTIONS</Text>

      {/* Start Live Metronome */}
      <Pressable
        style={({ pressed }) => [
          styles.actionRow,
          pressed && styles.actionRowPressed,
        ]}
        onPress={() => router.push('/live')}
        accessibilityRole="button"
        accessibilityLabel="Start Live Metronome coaching session"
      >
        <View style={styles.textColumn}>
          <Text style={styles.actionTitle}>Start Live Metronome</Text>
          <Text style={styles.actionSubtitle}>
            Real-time haptic taps &amp; turn-by-turn judgment
          </Text>
        </View>
        <View style={styles.actionAffordance}>
          <Text style={styles.arrowText}>&rarr;</Text>
        </View>
      </Pressable>

      {/* Hairline Divider */}
      <View style={styles.hairline} />

      {/* Pair Wristband */}
      <Pressable
        style={({ pressed }) => [
          styles.actionRow,
          pressed && styles.actionRowPressed,
        ]}
        onPress={() => router.push('/pair')}
        accessibilityRole="button"
        accessibilityLabel="Pair wristband device"
      >
        <View style={styles.textColumn}>
          <Text style={styles.actionTitle}>Wristband &amp; Hardware</Text>
          <Text style={styles.actionSubtitle}>
            Undertone Band &middot; BLE connected
          </Text>
        </View>
        <View style={styles.actionAffordance}>
          <Text style={styles.arrowText}>&rarr;</Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: SPACING.md,
  },
  sectionLabel: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    color: COLORS.inkMid,
    textTransform: 'uppercase',
    marginBottom: SPACING.sm,
  },
  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.md,
    minHeight: 56,
  },
  actionRowPressed: {
    opacity: 0.65,
  },
  textColumn: {
    flex: 1,
    paddingRight: SPACING.md,
  },
  actionTitle: {
    fontFamily: FONTS.uiMedium,
    fontSize: 16,
    color: COLORS.paper,
    marginBottom: 2,
  },
  actionSubtitle: {
    fontFamily: FONTS.ui,
    fontSize: 12,
    color: COLORS.inkMid,
    lineHeight: 16,
  },
  actionAffordance: {
    paddingLeft: SPACING.sm,
  },
  arrowText: {
    fontFamily: FONTS.mono,
    fontSize: 18,
    color: COLORS.paper,
  },
  hairline: {
    height: 1,
    backgroundColor: COLORS.hairline,
  },
});
