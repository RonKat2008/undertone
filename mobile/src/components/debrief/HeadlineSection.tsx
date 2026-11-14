import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';

interface HeadlineSectionProps {
  headlineFact: string;
}

export function HeadlineSection({ headlineFact }: HeadlineSectionProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.eyebrow}>SESSION DEBRIEF</Text>
      <Text style={styles.headline}>{headlineFact}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.hairline,
  },
  eyebrow: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    color: COLORS.inkMid,
    textTransform: 'uppercase',
    marginBottom: SPACING.sm,
  },
  headline: {
    fontFamily: FONTS.display,
    fontSize: 34,
    lineHeight: 40,
    color: COLORS.paper,
    textAlign: 'left',
  },
});
