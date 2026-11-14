import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';

interface StrengthSectionProps {
  strength: string;
}

export function StrengthSection({ strength }: StrengthSectionProps) {
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={styles.statusPip} />
        <Text style={styles.label}>STRENGTH OBSERVED</Text>
      </View>
      <Text style={styles.bodyText}>{strength}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: SPACING.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.hairline,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  statusPip: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.patterns.success,
    marginRight: SPACING.sm,
  },
  label: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    color: COLORS.inkMid,
    textTransform: 'uppercase',
  },
  bodyText: {
    fontFamily: FONTS.ui,
    fontSize: 16,
    lineHeight: 24,
    color: COLORS.paper,
    textAlign: 'left',
  },
});
