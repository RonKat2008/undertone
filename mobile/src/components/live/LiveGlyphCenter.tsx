import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Glyph } from '../Glyph';
import { NudgeRecord } from '../../bus/reducer';
import { COLORS, FONTS } from '../../theme/tokens';
import {
  getPatternFromRuleId,
  getNudgeMetadata,
  getStatusReplyInfo,
  formatClock,
} from './live-utils';

export interface LiveGlyphCenterProps {
  activeNudge: NudgeRecord | null;
  isNudgeActive: boolean;
  activeStatusReply: { verdict: string; ts: number } | null;
  isStatusReplyActive: boolean;
  lastNudge: NudgeRecord | null;
  sessionStatus: 'idle' | 'active' | 'ended';
  elapsedS: number;
  onDismissTakeover?: () => void;
}

export const LiveGlyphCenter: React.FC<LiveGlyphCenterProps> = ({
  activeNudge,
  isNudgeActive,
  activeStatusReply,
  isStatusReplyActive,
  lastNudge,
  sessionStatus,
  elapsedS,
  onDismissTakeover,
}) => {
  // 1. ACTIVE NUDGE TAKEOVER
  if (isNudgeActive && activeNudge) {
    const pattern = getPatternFromRuleId(activeNudge.rule_id);
    const metadata = getNudgeMetadata(activeNudge.rule_id, pattern);

    return (
      <Pressable style={styles.centerContainer} onPress={onDismissTakeover}>
        <View style={styles.glyphWrapper}>
          <Glyph pattern={pattern} playing={true} size="xl" color="#F7F5F0" />
        </View>

        <Text style={[styles.displayMessage, { color: '#F7F5F0' }]}>
          {activeNudge.message}
        </Text>

        <View style={styles.metadataPill}>
          <Text style={[styles.metadataText, { color: 'rgba(247, 245, 240, 0.85)' }]}>
            {metadata.reason.toUpperCase()} · {metadata.latency}
          </Text>
        </View>
      </Pressable>
    );
  }

  // 2. ACTIVE STATUS REPLY ("How am I doing?")
  if (isStatusReplyActive && activeStatusReply) {
    const statusInfo = getStatusReplyInfo(activeStatusReply.verdict);

    return (
      <Pressable style={styles.centerContainer} onPress={onDismissTakeover}>
        <Text style={[styles.statusEyebrow, { color: 'rgba(247, 245, 240, 0.75)' }]}>
          HOW AM I DOING?
        </Text>

        <View style={styles.glyphWrapper}>
          <Glyph pattern={statusInfo.pattern} playing={true} size="xl" color="#F7F5F0" />
        </View>

        <Text style={[styles.displayMessage, { color: '#F7F5F0', fontSize: 38 }]}>
          {statusInfo.title}
        </Text>

        <Text style={[styles.statusMeaning, { color: 'rgba(247, 245, 240, 0.9)' }]}>
          {statusInfo.meaning}
        </Text>

        <View style={styles.metadataPill}>
          <Text style={[styles.metadataText, { color: 'rgba(247, 245, 240, 0.8)' }]}>
            {statusInfo.pulses.toUpperCase()}
          </Text>
        </View>
      </Pressable>
    );
  }

  // 3. SETTLED: Shows last nudge
  if (lastNudge) {
    const pattern = getPatternFromRuleId(lastNudge.rule_id);
    const metadata = getNudgeMetadata(lastNudge.rule_id, pattern);
    const timeAgo = Math.max(0, Math.floor(elapsedS - lastNudge.ts));

    return (
      <View style={styles.centerContainer}>
        <View style={styles.settledHeader}>
          <View style={[styles.settledDot, { backgroundColor: COLORS.patterns[pattern] || COLORS.paper }]} />
          <Text style={styles.settledEyebrow}>LAST NUDGE</Text>
        </View>

        <View style={styles.glyphWrapper}>
          <Glyph
            pattern={pattern}
            playing={false}
            size="xl"
            color={COLORS.patterns[pattern] || COLORS.paper}
          />
        </View>

        <Text style={[styles.displayMessage, { color: COLORS.paper, fontSize: 36 }]}>
          {lastNudge.message}
        </Text>

        <Text style={styles.settledTimestamp}>
          at {formatClock(lastNudge.ts)} · {timeAgo}s ago
        </Text>

        <Text style={styles.settledReason}>
          {metadata.reason} · {metadata.latency}
        </Text>
      </View>
    );
  }

  // 4. SETTLED / IDLE METRONOME: Standing by, no nudges yet
  return (
    <View style={styles.centerContainer}>
      <View style={styles.glyphWrapper}>
        <Glyph pattern="tap" playing={false} size="xl" color={COLORS.hairline} />
      </View>

      <Text style={[styles.displayMessage, { color: COLORS.paper }]}>
        {sessionStatus === 'active' ? 'Listening' : 'Ready'}
      </Text>

      <Text style={styles.idleHint}>
        {sessionStatus === 'active'
          ? 'Double-tap band to check in'
          : 'Tap Start Session to begin coaching'}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  glyphWrapper: {
    marginBottom: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  displayMessage: {
    fontFamily: FONTS.display,
    fontSize: 44,
    lineHeight: 48,
    textAlign: 'center',
    marginBottom: 12,
    letterSpacing: -0.5,
  },
  metadataPill: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
  },
  metadataText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  statusEyebrow: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    marginBottom: 20,
    textTransform: 'uppercase',
  },
  statusMeaning: {
    fontFamily: FONTS.ui,
    fontSize: 15,
    textAlign: 'center',
    marginBottom: 10,
    opacity: 0.9,
  },
  settledHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 20,
  },
  settledDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  settledEyebrow: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    letterSpacing: 1.5,
    color: COLORS.inkMid,
  },
  settledTimestamp: {
    fontFamily: FONTS.mono,
    fontSize: 13,
    color: COLORS.inkMid,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
    marginBottom: 4,
  },
  settledReason: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.other,
  },
  idleHint: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: COLORS.inkMid,
    letterSpacing: 0.5,
    textAlign: 'center',
  },
});
