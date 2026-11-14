import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Glyph } from '../Glyph';
import { COLORS, FONTS } from '../../theme/tokens';
import type { PatternInfo } from './types';

interface PatternRowProps {
  item: PatternInfo;
  playing: boolean;
  onPress: () => void;
}

export function PatternRow({ item, playing, onPress }: PatternRowProps) {
  const patternColor = COLORS.patterns[item.pattern] || COLORS.paper;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${item.name}. Feel: ${item.feel}. Meaning: ${item.meaning}`}
      accessibilityHint="Tap to test haptic pattern and watch glyph rhythm"
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
        playing && styles.rowActive,
      ]}>
      {/* Glyph Stage */}
      <View style={[styles.glyphContainer, playing && { borderColor: patternColor }]}>
        <Glyph pattern={item.pattern} playing={playing} size="md" color={patternColor} />
      </View>

      {/* Pattern Details */}
      <View style={styles.detailsContainer}>
        {/* Name & Status Row */}
        <View style={styles.titleRow}>
          <Text style={styles.patternName}>{item.name}</Text>
          <View style={styles.badgeContainer}>
            {playing ? (
              <View style={styles.playingIndicator}>
                <View style={[styles.playingDot, { backgroundColor: patternColor }]} />
                <Text style={[styles.playingText, { color: patternColor }]}>PLAYING</Text>
              </View>
            ) : (
              <Text style={styles.timingLabel}>{item.timingLabel}</Text>
            )}
          </View>
        </View>

        {/* Feel */}
        <View style={styles.feelRow}>
          <Text style={styles.metaLabel}>FEEL</Text>
          <Text style={styles.feelText}>{item.feel}</Text>
        </View>

        {/* Meaning */}
        <View style={styles.meaningRow}>
          <Text style={styles.metaLabel}>MEANING</Text>
          <Text style={styles.meaningText} numberOfLines={2}>
            {item.meaning}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 20,
    backgroundColor: COLORS.ink,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.hairline,
    minHeight: 104,
  },
  rowPressed: {
    backgroundColor: COLORS.surface,
  },
  rowActive: {
    backgroundColor: '#16171A',
  },
  glyphContainer: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  detailsContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  patternName: {
    fontFamily: FONTS.monoMedium,
    fontSize: 16,
    color: COLORS.paper,
    letterSpacing: -0.3,
  },
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  timingLabel: {
    fontFamily: FONTS.mono,
    fontSize: 11,
    color: COLORS.inkMid,
    letterSpacing: 0.2,
  },
  playingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  playingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  playingText: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    letterSpacing: 0.8,
  },
  feelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  metaLabel: {
    fontFamily: FONTS.mono,
    fontSize: 9,
    color: COLORS.other,
    letterSpacing: 0.6,
    width: 58,
  },
  feelText: {
    fontFamily: FONTS.ui,
    fontSize: 13,
    color: COLORS.inkMid,
    flex: 1,
  },
  meaningRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  meaningText: {
    fontFamily: FONTS.uiMedium,
    fontSize: 13,
    color: COLORS.paper,
    flex: 1,
  },
});
