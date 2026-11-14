import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS } from '../../theme/tokens';

interface PatternSectionDividerProps {
  title: string;
  count: number;
  subtitle?: string;
}

export function PatternSectionDivider({ title, count, subtitle }: PatternSectionDividerProps) {
  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.count}>[{count}]</Text>
      </View>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    color: COLORS.paper,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  count: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.other,
  },
  subtitle: {
    fontFamily: FONTS.ui,
    fontSize: 11,
    color: COLORS.inkMid,
    marginTop: 2,
  },
});
