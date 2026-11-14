import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS } from '../../theme/tokens';
import { formatClock } from './live-utils';

export interface LiveTopBarProps {
  coachName: string;
  focusHabit: string;
  mode: string;
  isMicOn: boolean;
  elapsedS: number;
  budgetLeft: number;
  totalBudget?: number;
  inverted?: boolean;
}

export const LiveTopBar: React.FC<LiveTopBarProps> = ({
  coachName,
  focusHabit,
  mode,
  isMicOn,
  elapsedS,
  budgetLeft,
  totalBudget = 5,
  inverted = false,
}) => {
  const primaryTextColor = inverted ? '#F7F5F0' : COLORS.paper;
  const secondaryTextColor = inverted ? 'rgba(247, 245, 240, 0.7)' : COLORS.inkMid;
  const borderColor = inverted ? 'rgba(247, 245, 240, 0.2)' : COLORS.hairline;
  const activeDotColor = '#2563EB'; // solid blue when mic_on
  const inactiveDotColor = inverted ? 'rgba(247, 245, 240, 0.4)' : COLORS.other;

  const marks = Array.from({ length: totalBudget }, (_, i) => i < budgetLeft);

  return (
    <View style={[styles.container, { borderBottomColor: borderColor }]}>
      {/* Top row: Coach & Focus habit on left; Mode & Band connection dot on right */}
      <View style={styles.metaRow}>
        <View style={styles.coachGroup}>
          <Text style={[styles.coachName, { color: primaryTextColor }]} numberOfLines={1}>
            {coachName}
          </Text>
          <Text style={[styles.focusHabit, { color: secondaryTextColor }]} numberOfLines={1}>
            Focus: {focusHabit}
          </Text>
        </View>

        <View style={styles.statusGroup}>
          <View style={[styles.modeBadge, { borderColor }]}>
            <Text style={[styles.modeText, { color: primaryTextColor }]}>
              {mode.toUpperCase()}
            </Text>
          </View>
          <View style={styles.connectionItem}>
            <View
              style={[
                styles.dot,
                { backgroundColor: isMicOn ? activeDotColor : inactiveDotColor },
              ]}
            />
            <Text style={[styles.connectionLabel, { color: secondaryTextColor }]}>
              {isMicOn ? 'MIC ON' : 'IDLE'}
            </Text>
          </View>
        </View>
      </View>

      {/* Metric row: Session clock in Geist Mono and 5 buzz budget marks */}
      <View style={styles.metricRow}>
        <View style={styles.clockGroup}>
          <Text style={[styles.metricLabel, { color: secondaryTextColor }]}>SESSION</Text>
          <Text style={[styles.clock, { color: primaryTextColor }]}>
            {formatClock(elapsedS)}
          </Text>
        </View>

        <View style={styles.budgetGroup}>
          <Text style={[styles.metricLabel, { color: secondaryTextColor }]}>
            BUDGET {budgetLeft}/{totalBudget}
          </Text>
          <View style={styles.marksRow}>
            {marks.map((isRemaining, idx) => (
              <View
                key={idx}
                style={[
                  styles.mark,
                  {
                    backgroundColor: isRemaining
                      ? (inverted ? '#F7F5F0' : COLORS.paper)
                      : (inverted ? 'rgba(247, 245, 240, 0.25)' : COLORS.hairline),
                  },
                ]}
              />
            ))}
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  coachGroup: {
    flex: 1,
    marginRight: 12,
  },
  coachName: {
    fontFamily: FONTS.uiSemiBold,
    fontSize: 15,
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  focusHabit: {
    fontFamily: FONTS.ui,
    fontSize: 12,
  },
  statusGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderRadius: 3,
  },
  modeText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 0.8,
  },
  connectionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  connectionLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 0.5,
  },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  clockGroup: {
    alignItems: 'flex-start',
  },
  metricLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  clock: {
    fontFamily: FONTS.monoMedium,
    fontSize: 28,
    lineHeight: 32,
    fontVariant: ['tabular-nums'],
  },
  budgetGroup: {
    alignItems: 'flex-end',
  },
  marksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 24,
  },
  mark: {
    width: 6,
    height: 20,
    borderRadius: 1.5,
  },
});
