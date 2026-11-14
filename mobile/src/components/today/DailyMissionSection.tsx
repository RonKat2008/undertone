import React, { useState } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { DailyMission } from '../../bus/contracts';
import { chooseMission } from '../../api/client';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';

interface MissionOption {
  focus_rule_id: string;
  text: string;
  if_then: string;
  target: number;
}

const FALLBACK_MISSIONS: MissionOption[] = [
  {
    focus_rule_id: 'questions',
    text: 'Ask 3 open questions before your second story',
    if_then: 'When you finish a story, ask one open question',
    target: 3,
  },
  {
    focus_rule_id: 'monologue',
    text: 'Keep every turn under 30 seconds',
    if_then: 'When you hit 30 seconds, pass the turn',
    target: 4,
  },
  {
    focus_rule_id: 'filler',
    text: 'Pause instead of saying like',
    if_then: 'When thinking, hold silence for one beat',
    target: 5,
  },
  {
    focus_rule_id: 'interrupt',
    text: 'Leave a 2-second gap when they pause',
    if_then: 'When the other speaker hesitates, count to two',
    target: 3,
  },
];

interface DailyMissionSectionProps {
  initialMission: DailyMission;
}

export function DailyMissionSection({ initialMission }: DailyMissionSectionProps) {
  const [mission, setMission] = useState<DailyMission>(() => {
    // If backend mission has placeholder if_then or empty text, ensure robust fallback
    if (!initialMission.if_then || initialMission.if_then === 'When thinking, pause') {
      return {
        ...initialMission,
        text: 'Ask 3 open questions before your second story',
        if_then: 'When you finish a story, ask one open question',
        target: 3,
        progress: 1,
      };
    }
    return initialMission;
  });

  const [activeRuleId, setActiveRuleId] = useState(mission.focus_rule_id || 'questions');

  // Build list of alternative suggestions that are NOT the current mission
  const alternativeOptions = FALLBACK_MISSIONS.filter(
    (opt) => opt.focus_rule_id !== activeRuleId
  ).slice(0, 3);

  const handleSelectMission = (opt: MissionOption) => {
    setActiveRuleId(opt.focus_rule_id);
    setMission((prev) => ({
      ...prev,
      focus_rule_id: opt.focus_rule_id,
      text: opt.text,
      if_then: opt.if_then,
      target: opt.target,
      progress: 0,
      done: false,
    }));
    chooseMission(opt.focus_rule_id).catch(() => {});
  };

  const progressPct = Math.min(
    100,
    Math.max(0, Math.round((mission.progress / Math.max(1, mission.target)) * 100))
  );

  return (
    <View style={styles.container}>
      {/* Section Header */}
      <View style={styles.headerRow}>
        <Text style={styles.sectionLabel}>THE DAILY MISSION</Text>
        <Text style={styles.ruleTag}>{activeRuleId.toUpperCase()}</Text>
      </View>

      {/* Primary Goal / If-Then Plan in Instrument Serif */}
      <View style={styles.planBlock}>
        <Text style={styles.ifThenPlan}>
          &ldquo;{mission.if_then}&rdquo;
        </Text>
        <Text style={styles.goalDescription}>{mission.text}</Text>
      </View>

      {/* Progress Counter & Bar in Geist Mono */}
      <View style={styles.progressContainer}>
        <View style={styles.progressHeader}>
          <Text style={styles.progressLabel}>TODAY&rsquo;S REPETITIONS</Text>
          <View style={styles.progressValues}>
            <Text style={styles.progressMono}>
              {String(mission.progress).padStart(2, '0')}
            </Text>
            <Text style={styles.progressDivider}> / </Text>
            <Text style={styles.progressTargetMono}>
              {String(mission.target).padStart(2, '0')}
            </Text>
          </View>
        </View>

        {/* Crisp Hairline Progress Bar */}
        <View style={styles.progressBarTrack}>
          <View style={[styles.progressBarFill, { width: `${progressPct}%` }]} />
        </View>
      </View>

      {/* Alternative Missions List */}
      <View style={styles.alternativesContainer}>
        <View style={styles.alternativesHeader}>
          <Text style={styles.alternativesLabel}>SWITCH FOCUS</Text>
          <Text style={styles.alternativesHint}>Tap to change today&rsquo;s cue</Text>
        </View>

        {alternativeOptions.map((opt, idx) => (
          <Pressable
            key={opt.focus_rule_id}
            style={({ pressed }) => [
              styles.alternativeRow,
              idx > 0 && styles.hairlineDividerTop,
              pressed && styles.alternativePressed,
            ]}
            onPress={() => handleSelectMission(opt)}
            accessibilityRole="button"
            accessibilityLabel={`Switch to ${opt.text}`}
          >
            <View style={styles.alternativeContent}>
              <Text style={styles.alternativeIfThen}>{opt.if_then}</Text>
              <Text style={styles.alternativeTarget}>
                Target: {opt.target} reps
              </Text>
            </View>
            <Text style={styles.alternativeAction}>SELECT &rarr;</Text>
          </Pressable>
        ))}
      </View>
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
    marginBottom: SPACING.sm,
  },
  sectionLabel: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    color: COLORS.inkMid,
    textTransform: 'uppercase',
  },
  ruleTag: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: COLORS.patterns.wrap_up,
  },
  planBlock: {
    marginBottom: SPACING.lg,
  },
  ifThenPlan: {
    fontFamily: FONTS.display,
    fontSize: 28,
    lineHeight: 34,
    color: COLORS.paper,
    letterSpacing: -0.2,
    marginBottom: SPACING.xs,
  },
  goalDescription: {
    fontFamily: FONTS.ui,
    fontSize: 13,
    color: COLORS.inkMid,
    lineHeight: 18,
  },
  progressContainer: {
    marginBottom: SPACING.lg,
  },
  progressHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: SPACING.xs,
  },
  progressLabel: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 1.2,
    color: COLORS.inkMid,
  },
  progressValues: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  progressMono: {
    fontFamily: FONTS.monoMedium,
    fontSize: 16,
    color: COLORS.paper,
  },
  progressDivider: {
    fontFamily: FONTS.mono,
    fontSize: 14,
    color: COLORS.inkMid,
  },
  progressTargetMono: {
    fontFamily: FONTS.mono,
    fontSize: 14,
    color: COLORS.inkMid,
  },
  progressBarTrack: {
    height: 3,
    backgroundColor: COLORS.hairline,
    width: '100%',
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.paper,
  },
  alternativesContainer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.hairline,
    paddingTop: SPACING.md,
  },
  alternativesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: SPACING.sm,
  },
  alternativesLabel: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    color: COLORS.inkMid,
  },
  alternativesHint: {
    fontFamily: FONTS.ui,
    fontSize: 11,
    color: COLORS.other,
  },
  alternativeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm + 2,
  },
  hairlineDividerTop: {
    borderTopWidth: 1,
    borderTopColor: COLORS.hairline,
  },
  alternativePressed: {
    opacity: 0.6,
  },
  alternativeContent: {
    flex: 1,
    paddingRight: SPACING.md,
  },
  alternativeIfThen: {
    fontFamily: FONTS.uiMedium,
    fontSize: 14,
    color: COLORS.paper,
    lineHeight: 19,
    marginBottom: 2,
  },
  alternativeTarget: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.other,
  },
  alternativeAction: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 1,
    color: COLORS.inkMid,
  },
});
