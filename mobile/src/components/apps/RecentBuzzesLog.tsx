import React, { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING, TYPE_SCALE } from '../../theme/tokens';
import { Glyph } from '../Glyph';
import { RecentBuzz } from './types';

interface RecentBuzzesLogProps {
  buzzes: RecentBuzz[];
}

export function RecentBuzzesLog({ buzzes }: RecentBuzzesLogProps) {
  const [playingId, setPlayingId] = useState<string | null>(null);

  const handlePressBuzz = (id: string) => {
    setPlayingId(id);
    setTimeout(() => {
      setPlayingId((curr) => (curr === id ? null : curr));
    }, 1200);
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionTitle}>RECENT BUZZ LOG</Text>
        <Text style={styles.countBadge}>{buzzes.length} EVENTS</Text>
      </View>

      {buzzes.length === 0 ? (
        <View style={styles.emptyWell}>
          <Text style={styles.emptyText}>No recent haptic signals recorded.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {buzzes.map((buzz, index) => {
            const isPlaying = playingId === buzz.id;
            const isUndertone = buzz.source_app.toLowerCase() === 'undertone';

            return (
              <Pressable
                key={buzz.id}
                style={({ pressed }) => [
                  styles.buzzRow,
                  index > 0 && styles.itemBorderTop,
                  pressed && styles.buzzRowPressed,
                ]}
                onPress={() => handlePressBuzz(buzz.id)}
                accessibilityRole="button"
                accessibilityLabel={`Buzz from ${buzz.source_app}: ${buzz.pattern}, ${buzz.label}`}
              >
                <View style={styles.glyphBox}>
                  <Glyph
                    pattern={buzz.pattern}
                    size="sm"
                    playing={isPlaying}
                  />
                </View>

                <View style={styles.contentCol}>
                  <View style={styles.topMetaRow}>
                    <View
                      style={[
                        styles.sourcePill,
                        isUndertone ? styles.sourcePillNative : styles.sourcePillExternal,
                      ]}
                    >
                      <Text
                        style={[
                          styles.sourcePillText,
                          isUndertone ? styles.sourcePillTextNative : styles.sourcePillTextExternal,
                        ]}
                      >
                        {buzz.source_app}
                      </Text>
                    </View>
                    <Text style={styles.timestamp}>{buzz.timestamp}</Text>
                  </View>

                  <View style={styles.patternDetailRow}>
                    <Text style={styles.patternName}>{buzz.pattern}</Text>
                    <Text style={styles.bulletSeparator}>·</Text>
                    <Text style={styles.patternLabel} numberOfLines={1}>
                      {buzz.label}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: SPACING.xl,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontFamily: FONTS.mono,
    fontSize: TYPE_SCALE.xs,
    color: COLORS.inkMid,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  countBadge: {
    fontFamily: FONTS.mono,
    fontSize: TYPE_SCALE.xs,
    color: COLORS.other,
  },
  emptyWell: {
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.md,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairline,
  },
  emptyText: {
    fontFamily: FONTS.ui,
    fontSize: TYPE_SCALE.sm,
    color: COLORS.inkMid,
  },
  list: {
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairline,
  },
  buzzRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    gap: SPACING.md,
  },
  itemBorderTop: {
    borderTopWidth: 1,
    borderTopColor: COLORS.hairline,
  },
  buzzRowPressed: {
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
  },
  glyphBox: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contentCol: {
    flex: 1,
  },
  topMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  sourcePill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
  },
  sourcePillNative: {
    borderColor: COLORS.hairline,
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
  },
  sourcePillExternal: {
    borderColor: 'rgba(217, 119, 6, 0.3)',
    backgroundColor: 'rgba(217, 119, 6, 0.08)',
  },
  sourcePillText: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    letterSpacing: 0.3,
  },
  sourcePillTextNative: {
    color: COLORS.paper,
  },
  sourcePillTextExternal: {
    color: COLORS.patterns.wrap_up,
  },
  timestamp: {
    fontFamily: FONTS.mono,
    fontSize: TYPE_SCALE.xs,
    color: COLORS.other,
  },
  patternDetailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  patternName: {
    fontFamily: FONTS.monoMedium,
    fontSize: TYPE_SCALE.xs,
    color: COLORS.paper,
  },
  bulletSeparator: {
    fontFamily: FONTS.mono,
    fontSize: TYPE_SCALE.xs,
    color: COLORS.inkMid,
  },
  patternLabel: {
    flex: 1,
    fontFamily: FONTS.ui,
    fontSize: TYPE_SCALE.xs,
    color: COLORS.inkMid,
  },
});
