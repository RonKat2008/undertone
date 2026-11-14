import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';

export const SHOW_SAMPLE_BADGE = true;

interface SampleBadgeProps {
  label?: string;
}

export function SampleBadge({ label = 'SAMPLE' }: SampleBadgeProps) {
  if (!SHOW_SAMPLE_BADGE) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderColor: COLORS.hairline,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
  },
  text: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    color: COLORS.inkMid,
    textTransform: 'uppercase',
  },
});
