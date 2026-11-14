import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Person } from '../../bus/contracts';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';

export interface PersonRowProps {
  person: Person;
  isFirst?: boolean;
  onPress?: () => void;
}

export function PersonRow({ person, isFirst = false, onPress }: PersonRowProps) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.container,
        isFirst && styles.firstContainer,
        pressed && styles.pressed,
      ]}>
      {/* Name and session count header */}
      <View style={styles.headerRow}>
        <Text style={styles.name} numberOfLines={1}>
          {person.name}
        </Text>
        <Text style={styles.sessionCount}>
          {person.sessions} {person.sessions === 1 ? 'SESSION' : 'SESSIONS'}
        </Text>
      </View>

      {/* Pattern section */}
      <View style={styles.section}>
        <Text style={styles.sectionEyebrow}>RECURRING PATTERN</Text>
        <Text style={styles.patternText}>{person.pattern}</Text>
      </View>

      {/* Pre-meeting brief section */}
      <View style={styles.briefBox}>
        <View style={styles.briefHeader}>
          <Text style={styles.briefEyebrow}>PRE-MEETING BRIEF</Text>
        </View>
        <Text style={styles.briefText}>{person.brief}</Text>
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
  firstContainer: {
    borderTopWidth: 1,
    borderTopColor: COLORS.hairline,
  },
  pressed: {
    opacity: 0.85,
    backgroundColor: COLORS.surface,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: SPACING.md,
  },
  name: {
    fontFamily: FONTS.display,
    fontSize: 28,
    lineHeight: 32,
    color: COLORS.paper,
    flex: 1,
    marginRight: SPACING.sm,
  },
  sessionCount: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    letterSpacing: 0.8,
    color: COLORS.inkMid,
    fontVariant: ['tabular-nums'],
  },
  section: {
    marginBottom: SPACING.md,
  },
  sectionEyebrow: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: COLORS.other,
    marginBottom: SPACING.xs,
    textTransform: 'uppercase',
  },
  patternText: {
    fontFamily: FONTS.uiMedium,
    fontSize: 15,
    lineHeight: 21,
    color: COLORS.paper,
  },
  briefBox: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.other,
  },
  briefHeader: {
    marginBottom: 2,
  },
  briefEyebrow: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: COLORS.inkMid,
    textTransform: 'uppercase',
  },
  briefText: {
    fontFamily: FONTS.ui,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.paper,
  },
});
