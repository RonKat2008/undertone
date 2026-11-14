import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, GestureResponderEvent } from 'react-native';
import Svg, { Polygon, Rect } from 'react-native-svg';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';

const TOTAL_DURATION_S = 20;

export function RecapPlayer() {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentS, setCurrentS] = useState(0);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (isPlaying) {
      timerRef.current = setInterval(() => {
        setCurrentS((prev) => {
          if (prev >= TOTAL_DURATION_S) {
            setIsPlaying(false);
            return 0;
          }
          return Math.min(TOTAL_DURATION_S, prev + 0.1);
        });
      }, 100);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying]);

  const togglePlay = () => {
    if (currentS >= TOTAL_DURATION_S) {
      setCurrentS(0);
    }
    setIsPlaying(!isPlaying);
  };

  const handleBarPress = (e: GestureResponderEvent) => {
    // calculate relative press position
    const { locationX } = e.nativeEvent;
    // We assume width from layout or event
    // To be precise, clamp to 0..20
    // We can estimate or use layout width
  };

  const progressPct = Math.min(100, Math.max(0, (currentS / TOTAL_DURATION_S) * 100));

  const formatTime = (seconds: number) => {
    const s = Math.floor(seconds);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  };

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionHeader}>20-SECOND SPOKEN RECAP</Text>
        <Text style={styles.timecode}>
          {formatTime(currentS)} / {formatTime(TOTAL_DURATION_S)}
        </Text>
      </View>

      <View style={styles.playerRow}>
        <Pressable
          onPress={togglePlay}
          style={({ pressed }) => [
            styles.playButton,
            pressed && styles.playButtonPressed,
          ]}
          accessibilityRole="button"
          accessibilityLabel={isPlaying ? 'Pause recap' : 'Play recap'}
        >
          <Svg width={18} height={18} viewBox="0 0 24 24">
            {isPlaying ? (
              <>
                <Rect x="5" y="4" width="4" height="16" fill={COLORS.ink} />
                <Rect x="15" y="4" width="4" height="16" fill={COLORS.ink} />
              </>
            ) : (
              <Polygon points="6,3 20,12 6,21" fill={COLORS.ink} />
            )}
          </Svg>
        </Pressable>

        <Pressable
          style={styles.progressTrackWrapper}
          onPress={(e) => {
            // seek based on touch coordinates if layout width known
            const trackWidth = 260; // approximate mobile width for track
            const x = Math.max(0, Math.min(trackWidth, e.nativeEvent.locationX));
            const newS = Math.round((x / trackWidth) * TOTAL_DURATION_S);
            setCurrentS(newS);
          }}
        >
          <View style={styles.progressBarTrack}>
            <View style={[styles.progressBarFill, { width: `${progressPct}%` }]} />
          </View>
        </Pressable>
      </View>

      <Text style={styles.recapQuote}>
        “In this conversation you opened with clear structured frameworks, but took 70% of speaking time. Focus on two-second silent pauses to leave space for your partner.”
      </Text>
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
  timecode: {
    fontFamily: FONTS.mono,
    fontSize: 12,
    color: COLORS.paper,
    fontVariant: ['tabular-nums'],
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  playButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: COLORS.paper,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.md,
  },
  playButtonPressed: {
    opacity: 0.8,
  },
  progressTrackWrapper: {
    flex: 1,
    height: 30,
    justifyContent: 'center',
  },
  progressBarTrack: {
    height: 4,
    backgroundColor: COLORS.hairline,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: COLORS.paper,
  },
  recapQuote: {
    fontFamily: FONTS.ui,
    fontSize: 14,
    lineHeight: 20,
    color: COLORS.inkMid,
    fontStyle: 'italic',
    textAlign: 'left',
  },
});
