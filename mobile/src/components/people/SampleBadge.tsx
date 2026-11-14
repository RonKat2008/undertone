import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS } from '../../theme/tokens';

export interface SampleBadgeProps {
  visible?: boolean;
}

export function SampleBadge({ visible = true }: SampleBadgeProps) {
  if (!visible) return null;

  return (
    <View style={styles.badge}>
      <Text style={styles.label}>SAMPLE</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderWidth: 1,
    borderColor: COLORS.hairline,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  label: {
    fontFamily: FONTS.monoMedium,
    fontSize: 10,
    letterSpacing: 1.2,
    color: COLORS.inkMid,
    textTransform: 'uppercase',
  },
});
