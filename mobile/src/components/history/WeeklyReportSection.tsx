import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Debrief, WeeklyReport } from '../../bus/contracts';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';

interface WeeklyReportSectionProps {
  report: WeeklyReport;
  bestSessionTitle?: string;
  bestSessionMeta?: string;
  onSelectBestSession?: (sessionId: string) => void;
}

function formatMetricLabel(metric: keyof Debrief['numbers']): string {
  switch (metric) {
    case 'talk_ratio':
      return 'TALK RATIO';
    case 'interruptions':
      return 'INTERRUPTIONS';
    case 'fillers_per_min':
      return 'CRUTCH WORDS';
    case 'wpm':
      return 'PACE';
    case 'questions':
      return 'QUESTIONS';
    default:
      return String(metric).toUpperCase();
  }
}

function formatMetricValue(metric: keyof Debrief['numbers'], value: number): string {
  switch (metric) {
    case 'talk_ratio':
      return `${Math.round(value * 100)}%`;
    case 'wpm':
      return `${Math.round(value)} wpm`;
    case 'fillers_per_min':
      return `${value.toFixed(1)}/min`;
    case 'interruptions':
    case 'questions':
      return value.toFixed(1);
    default:
      return String(value);
  }
}

export function WeeklyReportSection({
  report,
  bestSessionTitle,
  bestSessionMeta,
  onSelectBestSession,
}: WeeklyReportSectionProps) {
  const formattedWeek = report.week_of
    ? `WEEK OF ${report.week_of.toUpperCase()}`
    : 'WEEKLY REPORT';

  return (
    <View style={styles.container}>
      {/* Section Header */}
      <View style={styles.headerRow}>
        <Text style={styles.sectionEyebrow}>WEEKLY REPORT</Text>
        <Text style={styles.weekDate}>{formattedWeek}</Text>
      </View>

      {/* Baseline Trends */}
      <View style={styles.trendsBlock}>
        <View style={styles.blockHeader}>
          <Text style={styles.subhead}>TRENDS AGAINST YOUR BASELINE</Text>
        </View>

        {report.trend.length === 0 ? (
          <Text style={styles.emptyText}>No baseline comparisons yet this week.</Text>
        ) : (
          <View style={styles.trendList}>
            {report.trend.map((item, idx) => (
              <View
                key={item.metric}
                style={[
                  styles.trendRow,
                  idx < report.trend.length - 1 && styles.trendRowBorder,
                ]}>
                <Text style={styles.metricName}>{formatMetricLabel(item.metric)}</Text>
                <View style={styles.trendValues}>
                  <Text style={styles.monoValue}>{formatMetricValue(item.metric, item.from)}</Text>
                  <Text style={styles.arrowText}>→</Text>
                  <Text style={[styles.monoValue, styles.monoValueTo]}>
                    {formatMetricValue(item.metric, item.to)}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Biggest Improvement */}
      {report.biggest_improvement ? (
        <View style={styles.sectionBlock}>
          <Text style={styles.subhead}>BIGGEST IMPROVEMENT</Text>
          <Text style={styles.improvementText}>{report.biggest_improvement}</Text>
        </View>
      ) : null}

      {/* Best Conversation */}
      {report.best_session_id && (bestSessionTitle || bestSessionMeta) ? (
        <View style={styles.sectionBlock}>
          <Text style={styles.subhead}>BEST CONVERSATION</Text>
          <Pressable
            onPress={() =>
              report.best_session_id && onSelectBestSession?.(report.best_session_id)
            }
            style={({ pressed }) => [
              styles.bestSessionContainer,
              pressed && styles.pressedState,
            ]}
            accessibilityRole="button"
            accessibilityLabel="View best conversation debrief">
            {bestSessionTitle ? (
              <Text style={styles.bestSessionTitle}>
                &ldquo;{bestSessionTitle}&rdquo;
              </Text>
            ) : null}
            {bestSessionMeta ? (
              <View style={styles.bestSessionMetaRow}>
                <Text style={styles.bestSessionMetaText}>{bestSessionMeta}</Text>
                <Text style={styles.viewDebriefLink}>VIEW DEBRIEF →</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
    paddingBottom: SPACING.xl,
    marginBottom: SPACING.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: SPACING.md,
  },
  sectionEyebrow: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.inkMid,
    letterSpacing: 1.2,
  },
  weekDate: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.other,
    letterSpacing: 0.8,
  },
  trendsBlock: {
    marginBottom: SPACING.lg,
  },
  blockHeader: {
    marginBottom: SPACING.sm,
  },
  subhead: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.inkMid,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: SPACING.xs,
  },
  trendList: {
    borderTopWidth: 1,
    borderTopColor: COLORS.hairline,
  },
  trendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  trendRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
  },
  metricName: {
    fontFamily: FONTS.ui,
    fontSize: 13,
    color: COLORS.paper,
    letterSpacing: 0.5,
  },
  trendValues: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  monoValue: {
    fontFamily: FONTS.mono,
    fontSize: 13,
    color: COLORS.inkMid,
  },
  arrowText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: COLORS.other,
    marginHorizontal: 8,
  },
  monoValueTo: {
    fontFamily: FONTS.monoMedium,
    fontSize: 13,
    color: COLORS.paper,
  },
  emptyText: {
    fontFamily: FONTS.ui,
    fontSize: 13,
    color: COLORS.other,
    marginTop: 4,
  },
  sectionBlock: {
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.hairline,
  },
  improvementText: {
    fontFamily: FONTS.ui,
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.paper,
    marginTop: 2,
  },
  bestSessionContainer: {
    marginTop: 4,
    paddingVertical: 4,
  },
  pressedState: {
    opacity: 0.6,
  },
  bestSessionTitle: {
    fontFamily: FONTS.display,
    fontSize: 22,
    lineHeight: 28,
    color: COLORS.paper,
    marginBottom: 6,
  },
  bestSessionMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bestSessionMetaText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.other,
    letterSpacing: 0.5,
  },
  viewDebriefLink: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.inkMid,
    letterSpacing: 0.8,
  },
});
