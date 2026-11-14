import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';
import { Debrief } from '../../bus/contracts';

interface NumbersSectionProps {
  numbers: Debrief['numbers'];
  vsLastTime: string | null;
}

export function NumbersSection({ numbers, vsLastTime }: NumbersSectionProps) {
  const talkPct = Math.round(numbers.talk_ratio * 100);
  const fillers = typeof numbers.fillers_per_min === 'number'
    ? numbers.fillers_per_min.toFixed(1)
    : String(numbers.fillers_per_min);
  const wpm = Math.round(numbers.wpm);

  return (
    <View style={styles.container}>
      <Text style={styles.sectionHeader}>CORE NUMBERS</Text>

      {/* Row 1: Primary speech balance */}
      <View style={styles.row}>
        <View style={[styles.statCell, styles.cellBorderRight]}>
          <Text style={styles.largeNumber}>{talkPct}%</Text>
          <Text style={styles.statLabel}>TALK RATIO</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.largeNumber}>{wpm}</Text>
          <Text style={styles.statLabel}>PACE (WPM)</Text>
        </View>
      </View>

      <View style={styles.hairlineDivider} />

      {/* Row 2: Interaction counts */}
      <View style={styles.row}>
        <View style={[styles.statCell, styles.cellBorderRight]}>
          <Text style={styles.mediumNumber}>{numbers.questions}</Text>
          <Text style={styles.statLabel}>QUESTIONS</Text>
        </View>
        <View style={[styles.statCell, styles.cellBorderRight]}>
          <Text style={styles.mediumNumber}>{numbers.interruptions}</Text>
          <Text style={styles.statLabel}>INTERRUPTIONS</Text>
        </View>
        <View style={styles.statCell}>
          <Text style={styles.mediumNumber}>{fillers}</Text>
          <Text style={styles.statLabel}>FILLERS / MIN</Text>
        </View>
      </View>

      {/* vs last time comparison */}
      {vsLastTime ? (
        <View style={styles.vsLastTimeRow}>
          <Text style={styles.vsLastTimeTag}>VS LAST TIME</Text>
          <Text style={styles.vsLastTimeText}>{vsLastTime}</Text>
        </View>
      ) : (
        <View style={styles.vsLastTimeRow}>
          <Text style={styles.vsLastTimeTag}>VS LAST TIME</Text>
          <Text style={styles.vsLastTimeEmpty}>First tracked session — baseline established.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: SPACING.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.hairline,
  },
  sectionHeader: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    color: COLORS.inkMid,
    textTransform: 'uppercase',
    marginBottom: SPACING.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  hairlineDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.hairline,
    marginVertical: SPACING.md,
  },
  statCell: {
    flex: 1,
    paddingVertical: SPACING.xs,
  },
  cellBorderRight: {
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: COLORS.hairline,
    paddingRight: SPACING.md,
    marginRight: SPACING.md,
  },
  largeNumber: {
    fontFamily: FONTS.monoMedium,
    fontSize: 34,
    lineHeight: 40,
    color: COLORS.paper,
    fontVariant: ['tabular-nums'],
    textAlign: 'left',
  },
  mediumNumber: {
    fontFamily: FONTS.monoMedium,
    fontSize: 26,
    lineHeight: 32,
    color: COLORS.paper,
    fontVariant: ['tabular-nums'],
    textAlign: 'left',
  },
  statLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    color: COLORS.inkMid,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  vsLastTimeRow: {
    marginTop: SPACING.lg,
    paddingTop: SPACING.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: COLORS.hairline,
  },
  vsLastTimeTag: {
    fontFamily: FONTS.monoMedium,
    fontSize: 10,
    letterSpacing: 1.5,
    color: COLORS.inkMid,
    marginBottom: SPACING.xs,
  },
  vsLastTimeText: {
    fontFamily: FONTS.ui,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.paper,
    textAlign: 'left',
  },
  vsLastTimeEmpty: {
    fontFamily: FONTS.ui,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.other,
    fontStyle: 'italic',
    textAlign: 'left',
  },
});
