import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';

interface ViewfinderFrameProps {
  statusText?: string;
  subtext?: string;
}

export function ViewfinderFrame({
  statusText = 'SEEKING BAND OPTICAL MARK',
  subtext = 'Align the glyph on the wristband clasp inside the frame',
}: ViewfinderFrameProps) {
  const FRAME_SIZE = 260;

  return (
    <View style={styles.container}>
      <View style={styles.frameWrapper}>
        <Svg
          width={FRAME_SIZE}
          height={FRAME_SIZE}
          viewBox={`0 0 ${FRAME_SIZE} ${FRAME_SIZE}`}
          accessibilityLabel="Optical viewfinder target frame"
        >
          {/* Subtle background field for viewfinder interior */}
          <Rect
            x="8"
            y="8"
            width={FRAME_SIZE - 16}
            height={FRAME_SIZE - 16}
            fill={COLORS.surface}
            fillOpacity={0.4}
          />

          {/* Inner hairline alignment boundary */}
          <Rect
            x="24"
            y="24"
            width={FRAME_SIZE - 48}
            height={FRAME_SIZE - 48}
            stroke={COLORS.hairline}
            strokeWidth={1}
            strokeDasharray="6, 6"
            fill="none"
          />

          {/* 4 Corner brackets (L-shapes) */}
          {/* Top-Left */}
          <Path
            d="M 8 36 L 8 8 L 36 8"
            stroke={COLORS.paper}
            strokeWidth={2}
            strokeLinecap="square"
            fill="none"
          />
          {/* Top-Right */}
          <Path
            d={`M ${FRAME_SIZE - 36} 8 L ${FRAME_SIZE - 8} 8 L ${FRAME_SIZE - 8} 36`}
            stroke={COLORS.paper}
            strokeWidth={2}
            strokeLinecap="square"
            fill="none"
          />
          {/* Bottom-Left */}
          <Path
            d={`M 8 ${FRAME_SIZE - 36} L 8 ${FRAME_SIZE - 8} L 36 ${FRAME_SIZE - 8}`}
            stroke={COLORS.paper}
            strokeWidth={2}
            strokeLinecap="square"
            fill="none"
          />
          {/* Bottom-Right */}
          <Path
            d={`M ${FRAME_SIZE - 36} ${FRAME_SIZE - 8} L ${FRAME_SIZE - 8} ${FRAME_SIZE - 8} L ${FRAME_SIZE - 8} ${FRAME_SIZE - 36}`}
            stroke={COLORS.paper}
            strokeWidth={2}
            strokeLinecap="square"
            fill="none"
          />

          {/* Optical axis edge ticks */}
          <Line
            x1={FRAME_SIZE / 2}
            y1="8"
            x2={FRAME_SIZE / 2}
            y2="18"
            stroke={COLORS.inkMid}
            strokeWidth={1.5}
          />
          <Line
            x1={FRAME_SIZE / 2}
            y1={FRAME_SIZE - 18}
            x2={FRAME_SIZE / 2}
            y2={FRAME_SIZE - 8}
            stroke={COLORS.inkMid}
            strokeWidth={1.5}
          />
          <Line
            x1="8"
            y1={FRAME_SIZE / 2}
            x2="18"
            y2={FRAME_SIZE / 2}
            stroke={COLORS.inkMid}
            strokeWidth={1.5}
          />
          <Line
            x1={FRAME_SIZE - 18}
            y1={FRAME_SIZE / 2}
            x2={FRAME_SIZE - 8}
            y2={FRAME_SIZE / 2}
            stroke={COLORS.inkMid}
            strokeWidth={1.5}
          />

          {/* Center reticle crosshairs */}
          <Line
            x1={FRAME_SIZE / 2 - 14}
            y1={FRAME_SIZE / 2}
            x2={FRAME_SIZE / 2 + 14}
            y2={FRAME_SIZE / 2}
            stroke={COLORS.inkMid}
            strokeWidth={1}
          />
          <Line
            x1={FRAME_SIZE / 2}
            y1={FRAME_SIZE / 2 - 14}
            x2={FRAME_SIZE / 2}
            y2={FRAME_SIZE / 2 + 14}
            stroke={COLORS.inkMid}
            strokeWidth={1}
          />
          <Circle
            cx={FRAME_SIZE / 2}
            cy={FRAME_SIZE / 2}
            r={3}
            fill="none"
            stroke={COLORS.paper}
            strokeWidth={1}
          />

          {/* Simulated optical target watermark: Undertone audio score bars */}
          <Rect
            x={FRAME_SIZE / 2 - 28}
            y={FRAME_SIZE / 2 - 36}
            width={6}
            height={20}
            fill={COLORS.hairline}
          />
          <Rect
            x={FRAME_SIZE / 2 - 16}
            y={FRAME_SIZE / 2 - 44}
            width={6}
            height={28}
            fill={COLORS.hairline}
          />
          <Rect
            x={FRAME_SIZE / 2 - 4}
            y={FRAME_SIZE / 2 - 32}
            width={8}
            height={16}
            fill={COLORS.hairline}
          />
          <Rect
            x={FRAME_SIZE / 2 + 10}
            y={FRAME_SIZE / 2 - 48}
            width={6}
            height={32}
            fill={COLORS.hairline}
          />
          <Rect
            x={FRAME_SIZE / 2 + 22}
            y={FRAME_SIZE / 2 - 36}
            width={6}
            height={20}
            fill={COLORS.hairline}
          />
        </Svg>

        {/* Optical status tag embedded at bottom edge */}
        <View style={styles.reticleBadge}>
          <View style={styles.statusDot} />
          <Text style={styles.reticleText}>{statusText}</Text>
        </View>
      </View>

      <Text style={styles.subtext}>{subtext}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.md,
  },
  frameWrapper: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  reticleBadge: {
    position: 'absolute',
    bottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.ink,
    borderWidth: 1,
    borderColor: COLORS.hairline,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 3,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.patterns.slow_down, // Blue optical indicator
    marginRight: 6,
  },
  reticleText: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1.2,
    color: COLORS.paper,
    textTransform: 'uppercase',
  },
  subtext: {
    marginTop: SPACING.md,
    fontFamily: FONTS.ui,
    fontSize: 13,
    lineHeight: 18,
    color: COLORS.inkMid,
    textAlign: 'center',
    maxWidth: 280,
  },
});
