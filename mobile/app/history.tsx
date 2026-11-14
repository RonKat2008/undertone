import React, { useEffect, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { getWeeklyReport, listSessions, listPeople } from '../src/api/client';
import { Person, SessionSummary, WeeklyReport } from '../src/bus/contracts';
import { COLORS, FONTS, SPACING } from '../src/theme/tokens';
import { SampleBadge } from '../src/components/history/SampleBadge';
import { WeeklyReportSection } from '../src/components/history/WeeklyReportSection';
import { SessionRow } from '../src/components/history/SessionRow';
import {
  SAMPLE_PEOPLE,
  SAMPLE_SESSIONS,
  SAMPLE_WEEKLY_REPORT,
} from '../src/components/history/sample-data';

/**
 * Single constant controlling visibility of the designed sample data indicator.
 */
export const SHOW_SAMPLE_BADGE = true;

export default function HistoryScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [weeklyReport, setWeeklyReport] = useState<WeeklyReport>(SAMPLE_WEEKLY_REPORT);
  const [sessions, setSessions] = useState<SessionSummary[]>(SAMPLE_SESSIONS);
  const [peopleMap, setPeopleMap] = useState<Record<string, string>>(SAMPLE_PEOPLE);

  useEffect(() => {
    let mounted = true;

    async function loadData() {
      try {
        const [rep, sessList, peopleList] = await Promise.all([
          getWeeklyReport(),
          listSessions(),
          listPeople(),
        ]);

        if (!mounted) return;

        // If client returned populated trends, use them; otherwise use sample report
        if (rep && rep.trend && rep.trend.length > 0) {
          setWeeklyReport(rep);
        } else {
          setWeeklyReport(SAMPLE_WEEKLY_REPORT);
        }

        // If client returned sessions, use them; otherwise use sample sessions
        if (sessList && sessList.length > 0) {
          setSessions(sessList);
        } else {
          setSessions(SAMPLE_SESSIONS);
        }

        // Map tagged people
        const pMap = { ...SAMPLE_PEOPLE };
        if (peopleList && peopleList.length > 0) {
          peopleList.forEach((p: Person) => {
            pMap[p.person_id] = p.name;
          });
        }
        setPeopleMap(pMap);
      } catch {
        // Fallback gracefully on sample data
        if (mounted) {
          setWeeklyReport(SAMPLE_WEEKLY_REPORT);
          setSessions(SAMPLE_SESSIONS);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadData();

    return () => {
      mounted = false;
    };
  }, []);

  const handleOpenDebrief = (_sessionId?: string) => {
    router.push('/debrief');
  };

  // Find best session title & meta if best_session_id exists
  const bestSession = weeklyReport.best_session_id
    ? sessions.find((s) => s.session_id === weeklyReport.best_session_id)
    : undefined;

  const bestSessionTitle = bestSession ? bestSession.headline_fact : undefined;
  const bestSessionPerson =
    bestSession?.person_id && peopleMap[bestSession.person_id]
      ? `with ${peopleMap[bestSession.person_id]}`
      : null;
  const bestSessionMeta = bestSession
    ? [bestSession.coach_name, bestSessionPerson].filter(Boolean).join(' · ')
    : undefined;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      {/* Masthead Header */}
      <View style={styles.masthead}>
        <View style={styles.titleRow}>
          <Text style={styles.screenTitle}>History</Text>
          <SampleBadge visible={SHOW_SAMPLE_BADGE} />
        </View>
        <Text style={styles.screenSubtitle}>
          Past sessions scored against your personal baseline
        </Text>
      </View>

      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>
        {/* Weekly Report Section at top */}
        <WeeklyReportSection
          report={weeklyReport}
          bestSessionTitle={bestSessionTitle}
          bestSessionMeta={bestSessionMeta}
          onSelectBestSession={handleOpenDebrief}
        />

        {/* Past Conversations Section */}
        <View style={styles.pastSessionsHeader}>
          <Text style={styles.pastEyebrow}>PAST CONVERSATIONS</Text>
          <Text style={styles.pastCount}>
            {loading ? '—' : `${sessions.length} RECORDED`}
          </Text>
        </View>

        {sessions.map((session, index) => (
          <SessionRow
            key={session.session_id}
            session={session}
            isFirst={index === 0}
            personName={
              session.person_id ? peopleMap[session.person_id] : undefined
            }
            onPress={handleOpenDebrief}
          />
        ))}

        {/* Bottom breathing room */}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.ink,
  },
  masthead: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.md,
    paddingBottom: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  screenTitle: {
    fontFamily: FONTS.display,
    fontSize: 34,
    color: COLORS.paper,
    letterSpacing: -0.5,
  },
  screenSubtitle: {
    fontFamily: FONTS.ui,
    fontSize: 12,
    color: COLORS.other,
    marginTop: 2,
  },
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
  },
  pastSessionsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
  },
  pastEyebrow: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.inkMid,
    letterSpacing: 1.2,
  },
  pastCount: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.other,
    letterSpacing: 0.8,
  },
  bottomSpacer: {
    height: 64,
  },
});
