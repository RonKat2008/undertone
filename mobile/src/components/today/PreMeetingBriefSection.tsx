import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { Person } from '../../bus/contracts';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';

interface PreMeetingBriefSectionProps {
  person: Person | null;
}

const DEFAULT_PERSON: Person = {
  person_id: 'p1',
  name: 'Alex Chen',
  sessions: 4,
  pattern: 'You interrupt Alex 3x more than anyone',
  brief: 'Last time you talked 70%. Ask about his trip.',
};

export function PreMeetingBriefSection({ person }: PreMeetingBriefSectionProps) {
  const router = useRouter();
  const activePerson = person || DEFAULT_PERSON;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={styles.sectionLabel}>PRE-MEETING BRIEF</Text>
        <Text style={styles.sessionsTag}>
          {String(activePerson.sessions).padStart(2, '0')} SESSIONS
        </Text>
      </View>

      {/* Person Name & Habit Pattern */}
      <View style={styles.nameBlock}>
        <Text style={styles.personName}>{activePerson.name}</Text>
        <Text style={styles.personPattern}>{activePerson.pattern}</Text>
      </View>

      {/* The Brief Quote */}
      <View style={styles.briefBlock}>
        <Text style={styles.briefQuote}>
          &ldquo;{activePerson.brief}&rdquo;
        </Text>
      </View>

      {/* Hairline Separator and Quick Action */}
      <View style={styles.actionRow}>
        <Pressable
          style={({ pressed }) => [
            styles.actionButton,
            pressed && styles.actionButtonPressed,
          ]}
          onPress={() => router.push('/live')}
          accessibilityRole="button"
          accessibilityLabel={`Start live session tagged with ${activePerson.name}`}
        >
          <Text style={styles.actionText}>
            COACH THIS CONVERSATION WITH {activePerson.name.toUpperCase()} &rarr;
          </Text>
        </Pressable>
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
  sessionsTag: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: COLORS.other,
  },
  nameBlock: {
    marginBottom: SPACING.sm,
  },
  personName: {
    fontFamily: FONTS.display,
    fontSize: 26,
    color: COLORS.paper,
    letterSpacing: -0.2,
    marginBottom: 2,
  },
  personPattern: {
    fontFamily: FONTS.ui,
    fontSize: 13,
    color: COLORS.patterns.wrap_up,
    lineHeight: 18,
  },
  briefBlock: {
    paddingVertical: SPACING.sm,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.hairline,
    paddingLeft: SPACING.md,
    marginVertical: SPACING.xs,
  },
  briefQuote: {
    fontFamily: FONTS.displayItalic,
    fontSize: 20,
    lineHeight: 26,
    color: COLORS.paper,
  },
  actionRow: {
    marginTop: SPACING.md,
  },
  actionButton: {
    borderWidth: 1,
    borderColor: COLORS.hairline,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
    alignItems: 'flex-start',
    backgroundColor: 'transparent',
  },
  actionButtonPressed: {
    backgroundColor: COLORS.surface,
  },
  actionText: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    letterSpacing: 1.2,
    color: COLORS.paper,
  },
});
