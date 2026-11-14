import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SessionSummary } from '../../bus/contracts';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';

interface SessionRowProps {
  session: SessionSummary;
  personName?: string;
  onPress: (sessionId: string) => void;
  isFirst?: boolean;
}

function formatSessionDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    const months = [
      'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN',
      'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'
    ];
    const month = months[d.getUTCMonth()] || '';
    const day = d.getUTCDate();
    const hours = String(d.getUTCHours()).padStart(2, '0');
    const mins = String(d.getUTCMinutes()).padStart(2, '0');
    return `${month} ${day} · ${hours}:${mins}`;
  } catch {
    return isoString;
  }
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}m`;
}

export function SessionRow({ session, personName, onPress }: SessionRowProps) {
  const dateStr = formatSessionDate(session.started_at);
  const durationStr = formatDuration(session.duration_s);
  const talkPct = `${Math.round(session.numbers.talk_ratio * 100)}%`;
  const intrCount = `${session.numbers.interruptions}`;
  const quesCount = `${session.numbers.questions}`;
  const wpmStr = `${Math.round(session.numbers.wpm)}`;

  return (
    <Pressable
      onPress={() => onPress(session.session_id)}
      style={({ pressed }) => [
        styles.container,
        pressed && styles.pressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Conversation from ${dateStr}: ${session.headline_fact}`}>
      {/* Meta Top Line: Date, Duration, Tagged Person, Coach, Mode */}
      <View style={styles.metaRow}>
        <View style={styles.metaLeft}>
          <Text style={styles.dateText}>{dateStr}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.durationText}>{durationStr}</Text>
          {personName ? (
            <>
              <Text style={styles.metaDot}>·</Text>
              <Text style={styles.personText}>w/ {personName}</Text>
            </>
          ) : null}
        </View>

        <View style={styles.metaRight}>
          <Text style={styles.coachText}>{session.coach_name}</Text>
          <View
            style={[
              styles.modeBadge,
              session.mode === 'practice' && styles.practiceBadge,
            ]}>
            <Text
              style={[
                styles.modeBadgeText,
                session.mode === 'practice' && styles.practiceBadgeText,
              ]}>
              {session.mode}
            </Text>
          </View>
        </View>
      </View>

      {/* Headline Fact in Instrument Serif */}
      <Text style={styles.headlineFact}>
        &ldquo;{session.headline_fact}&rdquo;
      </Text>

      {/* Key Numbers in Geist Mono */}
      <View style={styles.numbersGrid}>
        <View style={styles.numberItem}>
          <Text style={styles.numberLabel}>TALK</Text>
          <Text style={styles.numberValue}>{talkPct}</Text>
        </View>
        <View style={styles.numberDivider} />

        <View style={styles.numberItem}>
          <Text style={styles.numberLabel}>INTR</Text>
          <Text style={styles.numberValue}>{intrCount}</Text>
        </View>
        <View style={styles.numberDivider} />

        <View style={styles.numberItem}>
          <Text style={styles.numberLabel}>QUES</Text>
          <Text style={styles.numberValue}>{quesCount}</Text>
        </View>
        <View style={styles.numberDivider} />

        <View style={styles.numberItem}>
          <Text style={styles.numberLabel}>PACE</Text>
          <Text style={styles.numberValue}>{wpmStr}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
  },
  pressed: {
    backgroundColor: COLORS.surface,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    flexWrap: 'wrap',
    gap: 6,
  },
  metaLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dateText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.paper,
    letterSpacing: 0.5,
  },
  durationText: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.other,
  },
  metaDot: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.hairline,
    marginHorizontal: 6,
  },
  personText: {
    fontFamily: FONTS.uiMedium,
    fontSize: 12,
    color: COLORS.paper,
  },
  metaRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  coachText: {
    fontFamily: FONTS.ui,
    fontSize: 11,
    color: COLORS.inkMid,
  },
  modeBadge: {
    borderWidth: 1,
    borderColor: COLORS.hairline,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  practiceBadge: {
    borderColor: COLORS.patterns.slow_down,
  },
  modeBadgeText: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: COLORS.inkMid,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  practiceBadgeText: {
    color: COLORS.patterns.slow_down,
  },
  headlineFact: {
    fontFamily: FONTS.display,
    fontSize: 22,
    lineHeight: 28,
    color: COLORS.paper,
    marginBottom: SPACING.md,
  },
  numbersGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: SPACING.xs,
  },
  numberItem: {
    flexDirection: 'column',
  },
  numberLabel: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: COLORS.other,
    letterSpacing: 0.8,
    marginBottom: 2,
  },
  numberValue: {
    fontFamily: FONTS.monoMedium,
    fontSize: 13,
    color: COLORS.paper,
  },
  numberDivider: {
    width: 1,
    height: 18,
    backgroundColor: COLORS.hairline,
    marginHorizontal: 16,
  },
});
