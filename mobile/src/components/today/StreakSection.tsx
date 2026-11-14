import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Streak } from '../../bus/contracts';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';

interface StreakSectionProps {
  initialStreak: Streak;
}

const DAY_LABELS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function StreakSection({ initialStreak }: StreakSectionProps) {
  const [streak, setStreak] = useState<Streak>(initialStreak);
  const [justRepaired, setJustRepaired] = useState(false);

  const handleApplyFreeze = () => {
    if (!streak.freeze_available) return;

    // Find the most recent false day in week
    const updatedWeek = [...streak.week];
    const lastFalseIndex = updatedWeek.lastIndexOf(false);

    if (lastFalseIndex !== -1) {
      updatedWeek[lastFalseIndex] = true;
    }

    setStreak({
      days: streak.days + 1,
      freeze_available: false,
      week: updatedWeek,
    });
    setJustRepaired(true);
  };

  return (
    <View style={styles.container}>
      {/* Section Header */}
      <View style={styles.headerRow}>
        <Text style={styles.sectionLabel}>SEVEN-DAY RHYTHM</Text>
        <Text style={styles.philosophyLabel}>PRACTICE DAYS, NOT PERFECT DAYS</Text>
      </View>

      {/* Main Count & Description */}
      <View style={styles.countRow}>
        <Text style={styles.countNumber}>
          {String(streak.days).padStart(2, '0')}
        </Text>
        <View style={styles.countTextContainer}>
          <Text style={styles.countLabel}>DAYS PRACTISED</Text>
          <Text style={styles.countSubtext}>
            {streak.days > 0
              ? 'At least one coached conversation logged'
              : 'Begin your rhythm with a conversation today'}
          </Text>
        </View>
      </View>

      {/* 7-Day Visual Strip */}
      <View style={styles.weekStrip}>
        {streak.week.map((practised, index) => {
          const isToday = index === streak.week.length - 1;
          const label = DAY_LABELS[index % DAY_LABELS.length];

          return (
            <View key={index} style={styles.dayColumn}>
              <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>
                {label}
              </Text>
              <View
                style={[
                  styles.dayMark,
                  practised ? styles.dayMarkPractised : styles.dayMarkMissed,
                  isToday && styles.dayMarkToday,
                ]}
              >
                {practised ? (
                  <View style={styles.practisedIndicator} />
                ) : (
                  <View style={styles.missedIndicator} />
                )}
              </View>
              {isToday && <Text style={styles.todayAnnotation}>TODAY</Text>}
            </View>
          );
        })}
      </View>

      {/* Gentle Freeze Option — NEVER "you broke your streak" */}
      {streak.freeze_available && !justRepaired && (
        <View style={styles.freezeContainer}>
          <View style={styles.freezeInfo}>
            <Text style={styles.freezeTitle}>1 STREAK FREEZE AVAILABLE</Text>
            <Text style={styles.freezeBody}>
              Missed a session? Apply a freeze to keep your rhythm unbroken.
            </Text>
          </View>
          <Pressable
            style={({ pressed }) => [
              styles.freezeButton,
              pressed && styles.freezeButtonPressed,
            ]}
            onPress={handleApplyFreeze}
            accessibilityRole="button"
            accessibilityLabel="Apply streak freeze to repair missed day"
          >
            <Text style={styles.freezeButtonText}>REPAIR WITH FREEZE</Text>
          </Pressable>
        </View>
      )}

      {justRepaired && (
        <View style={styles.repairedContainer}>
          <Text style={styles.repairedText}>
            Freeze applied &middot; Practice rhythm restored.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: SPACING.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: SPACING.md,
  },
  sectionLabel: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    color: COLORS.inkMid,
    textTransform: 'uppercase',
  },
  philosophyLabel: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    letterSpacing: 1,
    color: COLORS.other,
    textTransform: 'uppercase',
  },
  countRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  countNumber: {
    fontFamily: FONTS.display,
    fontSize: 54,
    lineHeight: 56,
    color: COLORS.paper,
    marginRight: SPACING.md,
  },
  countTextContainer: {
    flex: 1,
  },
  countLabel: {
    fontFamily: FONTS.monoMedium,
    fontSize: 12,
    letterSpacing: 1.2,
    color: COLORS.paper,
    marginBottom: 2,
  },
  countSubtext: {
    fontFamily: FONTS.ui,
    fontSize: 12,
    color: COLORS.inkMid,
    lineHeight: 16,
  },
  weekStrip: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: COLORS.hairline,
  },
  dayColumn: {
    alignItems: 'center',
    flex: 1,
  },
  dayLabel: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.inkMid,
    marginBottom: SPACING.xs,
  },
  dayLabelToday: {
    color: COLORS.paper,
    fontFamily: FONTS.monoMedium,
  },
  dayMark: {
    width: 28,
    height: 36,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayMarkPractised: {
    borderColor: COLORS.paper,
    backgroundColor: 'transparent',
  },
  dayMarkMissed: {
    borderColor: COLORS.hairline,
    backgroundColor: 'transparent',
  },
  dayMarkToday: {
    borderWidth: 1.5,
  },
  practisedIndicator: {
    width: 14,
    height: 20,
    backgroundColor: COLORS.paper,
  },
  missedIndicator: {
    width: 8,
    height: 1,
    backgroundColor: COLORS.hairline,
  },
  todayAnnotation: {
    fontFamily: FONTS.mono,
    fontSize: 8,
    letterSpacing: 0.8,
    color: COLORS.paper,
    marginTop: 4,
  },
  freezeContainer: {
    marginTop: SPACING.md,
    paddingTop: SPACING.sm,
    flexDirection: 'column',
  },
  freezeInfo: {
    marginBottom: SPACING.sm,
  },
  freezeTitle: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: COLORS.patterns.slow_down,
    marginBottom: 2,
  },
  freezeBody: {
    fontFamily: FONTS.ui,
    fontSize: 12,
    color: COLORS.inkMid,
    lineHeight: 16,
  },
  freezeButton: {
    borderWidth: 1,
    borderColor: COLORS.hairline,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'transparent',
  },
  freezeButtonPressed: {
    backgroundColor: COLORS.surface,
  },
  freezeButtonText: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    letterSpacing: 1.2,
    color: COLORS.paper,
  },
  repairedContainer: {
    marginTop: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  repairedText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.patterns.success,
    letterSpacing: 0.5,
  },
});
