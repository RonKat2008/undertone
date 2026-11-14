import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useBus } from '../src/bus/use-bus';
import { listApps, approveApp, revokeApp } from '../src/api/client';
import { PendingRequests } from '../src/components/apps/PendingRequests';
import { ApprovedAppsList } from '../src/components/apps/ApprovedAppsList';
import { RecentBuzzesLog } from '../src/components/apps/RecentBuzzesLog';
import { PendingApp, ConnectedApp, RecentBuzz } from '../src/components/apps/types';
import { COLORS, FONTS, SPACING, TYPE_SCALE } from '../src/theme/tokens';
import { HapticPattern } from '../src/bus/contracts';

const INITIAL_PENDING: PendingApp[] = [
  {
    id: 'req_slide_timer',
    name: 'SlideTimer',
    reason: 'Requests permission to signal pacing and slide transitions via haptic pulse.',
    requestedAt: '3m ago',
  },
];

const INITIAL_APPROVED_FALLBACK: ConnectedApp[] = [
  {
    id: 'a1',
    name: 'Google Meet',
    lastUsed: '14m ago',
    permissions: 'Wrap-up and countdown nudges (max 4/hr)',
  },
  {
    id: 'a2',
    name: 'Keynote Remote',
    lastUsed: '2h ago',
    permissions: 'Slide progress ticks and countdowns',
  },
];

const INITIAL_BUZZES: RecentBuzz[] = [
  {
    id: 'b1',
    source_app: 'SlideTimer',
    pattern: 'tap',
    label: 'Slide transition pulse (Section 2)',
    timestamp: '14:32:10',
  },
  {
    id: 'b2',
    source_app: 'undertone',
    pattern: 'interrupt',
    label: 'Let them finish',
    timestamp: '14:28:44',
  },
  {
    id: 'b3',
    source_app: 'Google Meet',
    pattern: 'wrap_up',
    label: '5-minute meeting wrap up',
    timestamp: '14:15:02',
  },
  {
    id: 'b4',
    source_app: 'undertone',
    pattern: 'filler',
    label: 'Pause instead of filler',
    timestamp: '13:58:30',
  },
  {
    id: 'b5',
    source_app: 'Keynote Remote',
    pattern: 'approve',
    label: 'Presentation rehearsal start',
    timestamp: '12:40:15',
  },
  {
    id: 'b6',
    source_app: 'undertone',
    pattern: 'slow_down',
    label: 'Pace exceeded 170 wpm',
    timestamp: '11:22:04',
  },
];

export default function ConnectedAppsScreen() {
  const router = useRouter();
  const { state } = useBus();

  const [approvedApps, setApprovedApps] = useState<ConnectedApp[]>(INITIAL_APPROVED_FALLBACK);
  const [localPending, setLocalPending] = useState<PendingApp[]>(INITIAL_PENDING);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Load apps from API client on mount
  useEffect(() => {
    let mounted = true;
    listApps().then((fetched) => {
      if (!mounted) return;
      if (fetched && fetched.length > 0) {
        setApprovedApps((prev) => {
          const existingIds = new Set(prev.map((a) => a.id));
          const newOnes: ConnectedApp[] = fetched
            .filter((f) => !existingIds.has(f.id))
            .map((f) => ({
              id: f.id,
              name: f.name,
              lastUsed: 'Recently',
              permissions: 'Subtle nudges and status pulses',
            }));
          return [...prev, ...newOnes];
        });
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Merge bus state pending requests with local pending
  const combinedPendingRequests = useMemo(() => {
    const list: PendingApp[] = [];
    const seen = new Set<string>();

    // From bus state
    for (const req of state.pendingAppRequests) {
      if (!dismissedIds.has(req.id) && !seen.has(req.id)) {
        seen.add(req.id);
        list.push({
          id: req.id,
          name: req.name,
          reason: 'Incoming third-party authorization request',
          requestedAt: 'Just now',
        });
      }
    }

    // From local initial pending
    for (const req of localPending) {
      if (!dismissedIds.has(req.id) && !seen.has(req.id)) {
        seen.add(req.id);
        list.push(req);
      }
    }

    return list;
  }, [state.pendingAppRequests, localPending, dismissedIds]);

  // Merge live nudges from bus state into recent buzzes
  const displayBuzzes = useMemo(() => {
    const liveBuzzes: RecentBuzz[] = state.nudges.slice(-4).reverse().map((n) => {
      const patternName = (n.rule_id as HapticPattern) || 'tap';
      const date = new Date(Date.now() - (state.elapsedS - n.ts) * 1000);
      const timeStr = `${date.getHours().toString().padStart(2, '0')}:${date
        .getMinutes()
        .toString()
        .padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;

      return {
        id: `live_${n.id}`,
        source_app: 'undertone',
        pattern: patternName,
        label: n.message,
        timestamp: timeStr,
      };
    });

    return [...liveBuzzes, ...INITIAL_BUZZES];
  }, [state.nudges, state.elapsedS]);

  const handleApprove = async (id: string) => {
    const req = combinedPendingRequests.find((r) => r.id === id);
    if (!req) return;

    // Call API client
    await approveApp(id);

    // Update local state: remove from pending, add to approved
    setDismissedIds((prev) => new Set(prev).add(id));
    setLocalPending((prev) => prev.filter((r) => r.id !== id));
    setApprovedApps((prev) => [
      {
        id: req.id,
        name: req.name,
        lastUsed: 'Just now',
        permissions: 'Authorized via instant approval',
      },
      ...prev.filter((a) => a.id !== req.id),
    ]);
  };

  const handleDismiss = (id: string) => {
    setDismissedIds((prev) => new Set(prev).add(id));
    setLocalPending((prev) => prev.filter((r) => r.id !== id));
  };

  const handleRevoke = async (id: string) => {
    await revokeApp(id);
    setApprovedApps((prev) => prev.filter((a) => a.id !== id));
  };

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" />

      {/* Masthead */}
      <View style={styles.masthead}>
        <Pressable
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.backButtonPressed,
          ]}
          onPress={handleBack}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backButtonText}>← BACK</Text>
        </Pressable>

        <View style={styles.connectionStatus}>
          <View style={styles.statusDot} />
          <Text style={styles.statusText}>CLIENTS READY</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        {/* Title Block */}
        <View style={styles.titleBlock}>
          <Text style={styles.screenCategory}>SETTINGS & HARDWARE</Text>
          <Text style={styles.screenTitle}>Connected Apps</Text>
          <Text style={styles.screenDescription}>
            Third-party services authorized to route haptic signals, countdown reminders, and status buzzes through your Undertone wristband.
          </Text>
        </View>

        {/* 1. Pending Requests (Called out at top with Approve / Dismiss) */}
        <PendingRequests
          requests={combinedPendingRequests}
          onApprove={handleApprove}
          onDismiss={handleDismiss}
        />

        {/* 2. Approved Third-Party Apps List with Name, Last Used, and Revoke */}
        <ApprovedAppsList
          apps={approvedApps}
          onRevoke={handleRevoke}
        />

        {/* 3. Recent Buzzes Log showing source_app, Glyph, and timestamp */}
        <RecentBuzzesLog buzzes={displayBuzzes} />
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
  },
  backButton: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  backButtonPressed: {
    opacity: 0.6,
  },
  backButtonText: {
    fontFamily: FONTS.monoMedium,
    fontSize: TYPE_SCALE.xs,
    color: COLORS.paper,
    letterSpacing: 1,
  },
  connectionStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.patterns.success,
  },
  statusText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    color: COLORS.other,
    letterSpacing: 0.8,
  },
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  titleBlock: {
    marginBottom: SPACING.xl,
  },
  screenCategory: {
    fontFamily: FONTS.mono,
    fontSize: TYPE_SCALE.xs,
    color: COLORS.other,
    letterSpacing: 1.5,
    marginBottom: SPACING.xs,
    textTransform: 'uppercase',
  },
  screenTitle: {
    fontFamily: FONTS.display,
    fontSize: TYPE_SCALE.xxl,
    color: COLORS.paper,
    marginBottom: SPACING.xs + 2,
  },
  screenDescription: {
    fontFamily: FONTS.ui,
    fontSize: TYPE_SCALE.sm,
    color: COLORS.inkMid,
    lineHeight: 20,
  },
});
