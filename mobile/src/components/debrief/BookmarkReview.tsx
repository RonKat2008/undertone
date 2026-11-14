import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';
import { BookmarkReview as BookmarkType } from '../../bus/contracts';

interface BookmarkReviewProps {
  bookmarks: BookmarkType[];
}

export function BookmarkReview({ bookmarks }: BookmarkReviewProps) {
  const formatTime = (ts: number) => {
    const s = Math.floor(ts);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionHeader}>BOOKMARK REVIEW</Text>
        <Text style={styles.countBadge}>{bookmarks.length} MOMENTS</Text>
      </View>

      {bookmarks.length === 0 ? (
        <Text style={styles.emptyText}>No bookmarks recorded during this session.</Text>
      ) : (
        bookmarks.map((bm, index) => {
          const isPromise = bm.source === 'promise';
          return (
            <View
              key={`bm-${index}`}
              style={[
                styles.bookmarkCard,
                index < bookmarks.length - 1 && styles.cardBorderBottom,
              ]}
            >
              <View style={styles.metaRow}>
                <View
                  style={[
                    styles.sourceTag,
                    isPromise ? styles.promiseTag : styles.phoneTag,
                  ]}
                >
                  <Text
                    style={[
                      styles.sourceTagText,
                      isPromise ? styles.promiseTagText : styles.phoneTagText,
                    ]}
                  >
                    {isPromise ? 'PROMISE CAUGHT' : 'PHONE TAP'}
                  </Text>
                </View>
                <Text style={styles.timestamp}>{formatTime(bm.ts)}</Text>
              </View>

              <Text style={styles.snippet}>“{bm.snippet}”</Text>

              <Text style={styles.whatHappened}>{bm.what_happened}</Text>

              {bm.follow_up && (
                <View style={styles.followUpContainer}>
                  <Text style={styles.followUpLabel}>FOLLOW-UP</Text>
                  <Text style={styles.followUpText}>{bm.follow_up}</Text>
                </View>
              )}
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: SPACING.xl,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.hairline,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: SPACING.md,
  },
  sectionHeader: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    color: COLORS.inkMid,
    textTransform: 'uppercase',
  },
  countBadge: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: COLORS.other,
  },
  emptyText: {
    fontFamily: FONTS.ui,
    fontSize: 14,
    color: COLORS.other,
    fontStyle: 'italic',
  },
  bookmarkCard: {
    paddingVertical: SPACING.md,
  },
  cardBorderBottom: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.hairline,
    marginBottom: SPACING.xs,
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  sourceTag: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
    borderWidth: StyleSheet.hairlineWidth,
  },
  promiseTag: {
    borderColor: COLORS.patterns.wrap_up,
    backgroundColor: 'rgba(217, 119, 6, 0.08)',
  },
  phoneTag: {
    borderColor: COLORS.hairline,
    backgroundColor: COLORS.surface,
  },
  sourceTagText: {
    fontFamily: FONTS.monoMedium,
    fontSize: 9,
    letterSpacing: 1,
  },
  promiseTagText: {
    color: COLORS.patterns.wrap_up,
  },
  phoneTagText: {
    color: COLORS.paper,
  },
  timestamp: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.inkMid,
    fontVariant: ['tabular-nums'],
  },
  snippet: {
    fontFamily: FONTS.ui,
    fontSize: 15,
    lineHeight: 22,
    color: COLORS.paper,
    marginBottom: SPACING.xs,
    textAlign: 'left',
  },
  whatHappened: {
    fontFamily: FONTS.ui,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.inkMid,
    marginBottom: SPACING.sm,
    textAlign: 'left',
  },
  followUpContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: SPACING.xs,
  },
  followUpLabel: {
    fontFamily: FONTS.monoMedium,
    fontSize: 9,
    letterSpacing: 1.2,
    color: COLORS.patterns.wrap_up,
    marginRight: SPACING.sm,
  },
  followUpText: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: COLORS.paper,
    flex: 1,
    textAlign: 'left',
  },
});
