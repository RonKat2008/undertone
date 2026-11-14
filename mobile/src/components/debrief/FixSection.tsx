import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';

interface FixSectionProps {
  oneFix: string;
  ifThen: string;
}

export function FixSection({ oneFix, ifThen }: FixSectionProps) {
  return (
    <View style={styles.container}>
      <View style={styles.emphasisCard}>
        <View style={styles.headerRow}>
          <View style={styles.accentBar} />
          <Text style={styles.label}>ONE THING TO FIX</Text>
        </View>

        <Text style={styles.fixBehavior}>{oneFix}</Text>

        <View style={styles.planContainer}>
          <Text style={styles.planLabel}>RULE TO MEMORISE</Text>
          <Text style={styles.planText}>“{ifThen}”</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: SPACING.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.hairline,
  },
  emphasisCard: {
    backgroundColor: COLORS.surface,
    padding: SPACING.lg,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.patterns.wrap_up,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: COLORS.hairline,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  accentBar: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.patterns.wrap_up,
    marginRight: SPACING.sm,
  },
  label: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    color: COLORS.patterns.wrap_up,
    textTransform: 'uppercase',
  },
  fixBehavior: {
    fontFamily: FONTS.uiSemiBold,
    fontSize: 19,
    lineHeight: 26,
    color: COLORS.paper,
    marginBottom: SPACING.md,
    textAlign: 'left',
  },
  planContainer: {
    marginTop: SPACING.sm,
    paddingTop: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.hairline,
  },
  planLabel: {
    fontFamily: FONTS.monoMedium,
    fontSize: 10,
    letterSpacing: 1.5,
    color: COLORS.inkMid,
    textTransform: 'uppercase',
    marginBottom: SPACING.xs,
  },
  planText: {
    fontFamily: FONTS.displayItalic,
    fontSize: 22,
    lineHeight: 28,
    color: COLORS.paper,
    textAlign: 'left',
  },
});
