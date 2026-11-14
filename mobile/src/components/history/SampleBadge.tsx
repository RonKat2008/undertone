import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS, FONTS } from '../../theme/tokens';

export const SHOW_SAMPLE_BADGE = true;

interface SampleBadgeProps {
  visible?: boolean;
}

export function SampleBadge({ visible = SHOW_SAMPLE_BADGE }: SampleBadgeProps) {
  if (!visible) return null;

  return (
    <View style={styles.badge} accessibilityLabel="Sample data indicator">
      <Text style={styles.text}>SAMPLE</Text>
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
  text: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.inkMid,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
});
