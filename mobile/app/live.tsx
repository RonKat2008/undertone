import React, { useEffect, useState, useRef } from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useBus } from '../src/bus/use-bus';
import { NudgeRecord } from '../src/bus/reducer';
import { COLORS } from '../src/theme/tokens';
import { LiveTopBar } from '../src/components/live/LiveTopBar';
import { LiveGlyphCenter } from '../src/components/live/LiveGlyphCenter';
import { LiveBottomControls } from '../src/components/live/LiveBottomControls';
import { getPatternFromRuleId, getStatusReplyInfo } from '../src/components/live/live-utils';

export default function LiveScreen() {
  const { state, startSession, stopSession, addBookmark } = useBus();

  const [isNudgeActive, setIsNudgeActive] = useState(false);
  const [isStatusReplyActive, setIsStatusReplyActive] = useState(false);
  const [lastNudge, setLastNudge] = useState<NudgeRecord | null>(null);

  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevNudgeIdRef = useRef<string | null>(null);
  const prevStatusTsRef = useRef<number | null>(null);

  // Watch for new nudges
  useEffect(() => {
    if (state.activeNudge && state.activeNudge.id !== prevNudgeIdRef.current) {
      prevNudgeIdRef.current = state.activeNudge.id;
      setLastNudge(state.activeNudge);
      setIsNudgeActive(true);
      setIsStatusReplyActive(false);

      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
      nudgeTimerRef.current = setTimeout(() => {
        setIsNudgeActive(false);
      }, 4500);
    }
  }, [state.activeNudge]);

  // Watch for new status replies
  useEffect(() => {
    if (state.activeStatusReply && state.activeStatusReply.ts !== prevStatusTsRef.current) {
      prevStatusTsRef.current = state.activeStatusReply.ts;
      setIsStatusReplyActive(true);
      setIsNudgeActive(false);

      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
      statusTimerRef.current = setTimeout(() => {
        setIsStatusReplyActive(false);
      }, 4500);
    }
  }, [state.activeStatusReply]);

  // Clean up timers
  useEffect(() => {
    return () => {
      if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
      if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    };
  }, []);

  // Compute background and inversion
  let backgroundColor = COLORS.ink;
  let isInverted = false;

  if (isNudgeActive && state.activeNudge) {
    const pattern = getPatternFromRuleId(state.activeNudge.rule_id);
    backgroundColor = COLORS.patterns[pattern] || '#E03C31';
    isInverted = true;
  } else if (isStatusReplyActive && state.activeStatusReply) {
    const statusInfo = getStatusReplyInfo(state.activeStatusReply.verdict);
    backgroundColor = COLORS.patterns[statusInfo.pattern] || '#16A34A';
    isInverted = true;
  }

  // Active coach & habit info
  const coachName = state.activeCoach?.name || 'Consulting Prep';
  const rawHabit = state.policy?.focus_rule_id || state.activeCoach?.nudge_policy.focus_rule_id || 'filler';
  const focusHabit = rawHabit.charAt(0).toUpperCase() + rawHabit.slice(1).replace(/_/g, ' ');
  const mode = state.mode ? (state.mode === 'practice' ? 'Practice' : 'Regular') : 'Regular';

  // Budget
  const totalBudget = state.policy?.budget_per_session ?? state.activeCoach?.nudge_policy.budget_per_session ?? 5;
  const budgetLeft = Math.max(0, totalBudget - state.nudges.length);

  // Band connection: mic_on when band is connected and session active
  const isMicOn = state.bandConnected && state.sessionStatus === 'active';

  const handleDismissTakeover = () => {
    if (isNudgeActive) setIsNudgeActive(false);
    if (isStatusReplyActive) setIsStatusReplyActive(false);
  };

  return (
    <View style={[styles.screen, { backgroundColor }]}>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        {/* Top bar: Coach, Habit, Mode, Mic connection dot, Clock, Budget */}
        <LiveTopBar
          coachName={coachName}
          focusHabit={focusHabit}
          mode={mode}
          isMicOn={isMicOn}
          elapsedS={state.elapsedS}
          budgetLeft={budgetLeft}
          totalBudget={totalBudget}
          inverted={isInverted}
        />

        {/* Center: Large Glyph area (Nudge takeover / Status reply / Settled last nudge / Idle) */}
        <LiveGlyphCenter
          activeNudge={state.activeNudge}
          isNudgeActive={isNudgeActive}
          activeStatusReply={state.activeStatusReply}
          isStatusReplyActive={isStatusReplyActive}
          lastNudge={lastNudge}
          sessionStatus={state.sessionStatus}
          elapsedS={state.elapsedS}
          onDismissTakeover={handleDismissTakeover}
        />

        {/* Bottom: Thumb-reachable Bookmark & Start/Stop controls */}
        <LiveBottomControls
          sessionStatus={state.sessionStatus}
          onStartSession={startSession}
          onStopSession={stopSession}
          onAddBookmark={addBookmark}
          bookmarkCount={state.bookmarks.length}
          inverted={isInverted}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
  },
});
