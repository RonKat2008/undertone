import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING } from '../src/theme/tokens';
import { getMissionToday, getStreak, listPeople } from '../src/api/client';
import { DailyMission, Streak, Person } from '../src/bus/contracts';
import {
  SampleBadge,
  SHOW_SAMPLE_BADGE,
  DailyMissionSection,
  StreakSection,
  PreMeetingBriefSection,
  QuickActionsSection,
} from '../src/components/today';

export { SHOW_SAMPLE_BADGE };

function formatTodayDate(): string {
  const now = new Date();
  const options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  };
  return now.toLocaleDateString('en-US', options).toUpperCase();
}

export default function TodayScreen() {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [mission, setMission] = useState<DailyMission | null>(null);
  const [streak, setStreak] = useState<Streak | null>(null);
  const [person, setPerson] = useState<Person | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function loadData() {
      try {
        const [missionData, streakData, peopleData] = await Promise.all([
          getMissionToday(),
          getStreak(),
          listPeople(),
        ]);

        if (!isMounted) return;

        setMission(missionData);
        setStreak(streakData);
        setPerson(peopleData.length > 0 ? peopleData[0] : null);
      } catch (err) {
        // Fallbacks are handled inside each section
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 20) }]}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[
          styles.contentContainer,
          { paddingBottom: Math.max(insets.bottom, 24) + SPACING.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Masthead Header */}
        <View style={styles.masthead}>
          <View style={styles.mastheadTopRow}>
            <Text style={styles.brandMark}>UNDERTONE</Text>
            {SHOW_SAMPLE_BADGE && <SampleBadge label="SAMPLE" />}
          </View>
          <View style={styles.mastheadBottomRow}>
            <Text style={styles.dateLabel}>{formatTodayDate()}</Text>
            <Text style={styles.modeLabel}>DAILY PRACTICE</Text>
          </View>
        </View>

        {/* Hairline Separator */}
        <View style={styles.hairline} />

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={COLORS.paper} />
          </View>
        ) : (
          <>
            {/* 1. The Daily Mission Section */}
            {mission && <DailyMissionSection initialMission={mission} />}

            {/* Hairline Separator */}
            <View style={styles.hairline} />

            {/* 2. Practice Streak (Last 7 Days + Freeze) */}
            {streak && <StreakSection initialStreak={streak} />}

            {/* Hairline Separator */}
            <View style={styles.hairline} />

            {/* 3. Pre-meeting brief */}
            <PreMeetingBriefSection person={person} />

            {/* Hairline Separator */}
            <View style={styles.hairline} />

            {/* 4. Quick Actions: Start Live or Pair */}
            <QuickActionsSection />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: COLORS.ink,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: SPACING.lg,
  },
  masthead: {
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.md,
  },
  mastheadTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  brandMark: {
    fontFamily: FONTS.monoMedium,
    fontSize: 12,
    letterSpacing: 2,
    color: COLORS.paper,
  },
  mastheadBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  dateLabel: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 1,
    color: COLORS.inkMid,
  },
  modeLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: COLORS.other,
  },
  hairline: {
    height: 1,
    backgroundColor: COLORS.hairline,
  },
  loadingContainer: {
    paddingVertical: SPACING.xxl,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
