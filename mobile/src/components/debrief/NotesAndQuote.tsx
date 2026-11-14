import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';

interface NotesAndQuoteProps {
  notes: string[];
  bestMomentQuote: string;
}

export function NotesAndQuote({ notes, bestMomentQuote }: NotesAndQuoteProps) {
  return (
    <View style={styles.container}>
      {/* Discussion Notes */}
      <View style={styles.notesSection}>
        <Text style={styles.sectionHeader}>NOTES ON WHAT WAS DISCUSSED</Text>
        {notes.map((note, index) => (
          <View key={`note-${index}`} style={styles.noteItem}>
            <Text style={styles.noteIndex}>
              {(index + 1).toString().padStart(2, '0')}
            </Text>
            <Text style={styles.noteText}>{note}</Text>
          </View>
        ))}
      </View>

      <View style={styles.hairlineDivider} />

      {/* Best Moment Pull Quote */}
      <View style={styles.quoteSection}>
        <Text style={styles.quoteHeader}>BEST MOMENT</Text>
        <Text style={styles.pullQuote}>
          “{bestMomentQuote}”
        </Text>
        <Text style={styles.quoteAttribution}>
          Wearer · Captured high-clarity structural explanation
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: SPACING.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.hairline,
  },
  notesSection: {
    marginBottom: SPACING.lg,
  },
  sectionHeader: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    color: COLORS.inkMid,
    textTransform: 'uppercase',
    marginBottom: SPACING.md,
  },
  noteItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.sm,
  },
  noteIndex: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.other,
    width: 28,
    paddingTop: 2,
    fontVariant: ['tabular-nums'],
  },
  noteText: {
    flex: 1,
    fontFamily: FONTS.ui,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.paper,
    textAlign: 'left',
  },
  hairlineDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: COLORS.hairline,
    marginVertical: SPACING.lg,
  },
  quoteSection: {
    paddingLeft: SPACING.md,
    borderLeftWidth: 2,
    borderLeftColor: COLORS.patterns.success,
  },
  quoteHeader: {
    fontFamily: FONTS.monoMedium,
    fontSize: 10,
    letterSpacing: 1.5,
    color: COLORS.patterns.success,
    textTransform: 'uppercase',
    marginBottom: SPACING.sm,
  },
  pullQuote: {
    fontFamily: FONTS.displayItalic,
    fontSize: 24,
    lineHeight: 32,
    color: COLORS.paper,
    marginBottom: SPACING.sm,
    textAlign: 'left',
  },
  quoteAttribution: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.inkMid,
    textAlign: 'left',
  },
});
