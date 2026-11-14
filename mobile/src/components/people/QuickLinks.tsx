import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';

export function QuickLinks() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerLabel}>SETTINGS & TOOLS</Text>
      </View>

      <Pressable
        onPress={() => router.push('/patterns')}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
        <View style={styles.textGroup}>
          <Text style={styles.title}>Pattern Tester</Text>
          <Text style={styles.subtext}>11 haptic signatures & visual glyphs</Text>
        </View>
        <Text style={styles.arrow}>→</Text>
      </Pressable>

      <Pressable
        onPress={() => router.push('/apps')}
        style={({ pressed }) => [styles.row, styles.lastRow, pressed && styles.rowPressed]}>
        <View style={styles.textGroup}>
          <Text style={styles.title}>Connected Apps</Text>
          <Text style={styles.subtext}>Third-party buzz permissions & devices</Text>
        </View>
        <Text style={styles.arrow}>→</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: SPACING.xl,
    marginBottom: SPACING.xxl,
  },
  header: {
    paddingBottom: SPACING.xs,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
  },
  headerLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    color: COLORS.other,
    textTransform: 'uppercase',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
  },
  lastRow: {
    borderBottomWidth: 1,
  },
  rowPressed: {
    opacity: 0.7,
  },
  textGroup: {
    flex: 1,
    marginRight: SPACING.md,
  },
  title: {
    fontFamily: FONTS.uiMedium,
    fontSize: 15,
    color: COLORS.paper,
    marginBottom: 2,
  },
  subtext: {
    fontFamily: FONTS.ui,
    fontSize: 12,
    color: COLORS.inkMid,
  },
  arrow: {
    fontFamily: FONTS.mono,
    fontSize: 16,
    color: COLORS.paper,
  },
});
