import React, { useState } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent, PanResponder } from 'react-native';
import Svg, { Path, Line, Rect, Text as SvgText, G } from 'react-native-svg';
import { COLORS, FONTS, SPACING } from '../../theme/tokens';
import { TimelinePoint, BookmarkReview } from '../../bus/contracts';
import { generateMockTimeline } from './mock-debrief';

interface TimelineTracesProps {
  timeline: TimelinePoint[];
  bookmarks?: BookmarkReview[];
}

export function TimelineTraces({ timeline, bookmarks = [] }: TimelineTracesProps) {
  const [containerWidth, setContainerWidth] = useState(350);
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);

  // Fallback if empty timeline passed
  const points = (timeline && timeline.length >= 2) ? timeline : generateMockTimeline(180);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 100) setContainerWidth(w);
  };

  const padLeft = 40;
  const padRight = 16;
  const chartWidth = Math.max(100, containerWidth - padLeft - padRight);

  const tMin = points[0]?.t ?? 0;
  const tMax = Math.max(1, points[points.length - 1]?.t ?? 180);

  // Trace 1: Pace (wpm)
  const minWpm = 110;
  const maxWpm = 190;
  const trace1Top = 20;
  const traceHeight = 44;

  // Trace 2: Volume (dBFS)
  const minVol = -36;
  const maxVol = -12;
  const trace2Top = 85;

  // Trace 3: Hand Energy (0..1)
  const trace3Top = 150;

  const totalSvgHeight = 220;

  // Map point to X
  const getX = (t: number) => padLeft + ((t - tMin) / (tMax - tMin)) * chartWidth;

  // Map point to Y for each trace
  const getYTrace1 = (wpm: number) => {
    const norm = Math.max(0, Math.min(1, (wpm - minWpm) / (maxWpm - minWpm)));
    return trace1Top + (1 - norm) * traceHeight;
  };

  const getYTrace2 = (vol: number) => {
    const norm = Math.max(0, Math.min(1, (vol - minVol) / (maxVol - minVol)));
    return trace2Top + (1 - norm) * traceHeight;
  };

  const getYTrace3 = (energy: number) => {
    const norm = Math.max(0, Math.min(1, energy));
    return trace3Top + (1 - norm) * traceHeight;
  };

  // Build SVG Path strings
  let path1 = '';
  let path2 = '';
  let path3 = '';

  points.forEach((p, i) => {
    const x = getX(p.t);
    const y1 = getYTrace1(p.wpm);
    const y2 = getYTrace2(p.volume_db);
    const y3 = getYTrace3(p.hand_energy);

    if (i === 0) {
      path1 += `M ${x.toFixed(1)} ${y1.toFixed(1)}`;
      path2 += `M ${x.toFixed(1)} ${y2.toFixed(1)}`;
      path3 += `M ${x.toFixed(1)} ${y3.toFixed(1)}`;
    } else {
      path1 += ` L ${x.toFixed(1)} ${y1.toFixed(1)}`;
      path2 += ` L ${x.toFixed(1)} ${y2.toFixed(1)}`;
      path3 += ` L ${x.toFixed(1)} ${y3.toFixed(1)}`;
    }
  });

  // Reference lines
  const baselineWpmY = getYTrace1(150);
  const targetVolY = getYTrace2(-20);
  const naturalGestureTopY = getYTrace3(0.7);
  const naturalGestureBottomY = getYTrace3(0.3);

  // Time ticks (every 60 seconds)
  const timeTicks: number[] = [];
  for (let t = 0; t <= tMax; t += 60) {
    timeTicks.push(t);
  }

  // Active scrubbed point
  const activePoint = scrubIndex !== null ? points[scrubIndex] : points[points.length - 1];

  const formatSec = (s: number) => {
    const m = Math.floor(s / 60);
    const rem = Math.floor(s % 60);
    return `${m}:${rem < 10 ? '0' : ''}${rem}`;
  };

  // Pan responder for scrubbing
  const panResponder = PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (evt) => {
      handleTouch(evt.nativeEvent.locationX);
    },
    onPanResponderMove: (evt) => {
      handleTouch(evt.nativeEvent.locationX);
    },
    onPanResponderRelease: () => {
      // keep last position or leave active
    },
  });

  const handleTouch = (touchX: number) => {
    const relX = Math.max(0, Math.min(chartWidth, touchX - padLeft));
    const targetT = tMin + (relX / chartWidth) * (tMax - tMin);

    let closestIdx = 0;
    let closestDist = Infinity;
    points.forEach((p, idx) => {
      const dist = Math.abs(p.t - targetT);
      if (dist < closestDist) {
        closestDist = dist;
        closestIdx = idx;
      }
    });
    setScrubIndex(closestIdx);
  };

  const scrubX = activePoint ? getX(activePoint.t) : padLeft;

  return (
    <View style={styles.container} onLayout={onLayout}>
      <View style={styles.headerRow}>
        <Text style={styles.sectionHeader}>VOICE & BODY TIMELINE</Text>
        <Text style={styles.subHeader}>3 ALIGNED TRACES</Text>
      </View>

      {/* Live readout strip */}
      {activePoint && (
        <View style={styles.readoutStrip}>
          <Text style={styles.readoutTime}>{formatSec(activePoint.t)}</Text>
          <Text style={styles.readoutDivider}>·</Text>
          <Text style={[styles.readoutMetric, { color: COLORS.patterns.slow_down }]}>
            {Math.round(activePoint.wpm)} wpm
          </Text>
          <Text style={styles.readoutDivider}>·</Text>
          <Text style={[styles.readoutMetric, { color: COLORS.patterns.wrap_up }]}>
            {activePoint.volume_db.toFixed(1)} dB
          </Text>
          <Text style={styles.readoutDivider}>·</Text>
          <Text style={[styles.readoutMetric, { color: COLORS.patterns.still }]}>
            {activePoint.hand_energy.toFixed(2)} energy
          </Text>
        </View>
      )}

      {/* SVG Container with pan touch handler */}
      <View {...panResponder.panHandlers} style={styles.svgWrapper}>
        <Svg width={containerWidth} height={totalSvgHeight}>
          {/* Natural gesture range shading in Trace 3 */}
          <Rect
            x={padLeft}
            y={naturalGestureTopY}
            width={chartWidth}
            height={naturalGestureBottomY - naturalGestureTopY}
            fill="#7C3AED"
            opacity={0.10}
          />

          {/* Trace 1: Pace labels and guide */}
          <SvgText
            x={10}
            y={trace1Top + 14}
            fill={COLORS.inkMid}
            fontSize={9}
            fontFamily={FONTS.mono}
          >
            PACE
          </SvgText>
          <SvgText
            x={10}
            y={trace1Top + 26}
            fill={COLORS.other}
            fontSize={8}
            fontFamily={FONTS.mono}
          >
            wpm
          </SvgText>
          <Line
            x1={padLeft}
            y1={baselineWpmY}
            x2={padLeft + chartWidth}
            y2={baselineWpmY}
            stroke={COLORS.hairline}
            strokeDasharray="4 4"
            strokeWidth={1}
          />

          {/* Trace 1 Line */}
          <Path
            d={path1}
            fill="none"
            stroke={COLORS.patterns.slow_down}
            strokeWidth={1.75}
          />

          {/* Trace 2: Volume labels and guide */}
          <SvgText
            x={10}
            y={trace2Top + 14}
            fill={COLORS.inkMid}
            fontSize={9}
            fontFamily={FONTS.mono}
          >
            VOL
          </SvgText>
          <SvgText
            x={10}
            y={trace2Top + 26}
            fill={COLORS.other}
            fontSize={8}
            fontFamily={FONTS.mono}
          >
            dBFS
          </SvgText>
          <Line
            x1={padLeft}
            y1={targetVolY}
            x2={padLeft + chartWidth}
            y2={targetVolY}
            stroke={COLORS.hairline}
            strokeDasharray="4 4"
            strokeWidth={1}
          />

          {/* Trace 2 Line */}
          <Path
            d={path2}
            fill="none"
            stroke={COLORS.patterns.wrap_up}
            strokeWidth={1.75}
          />

          {/* Trace 3: Hand Energy labels and guide */}
          <SvgText
            x={10}
            y={trace3Top + 14}
            fill={COLORS.inkMid}
            fontSize={9}
            fontFamily={FONTS.mono}
          >
            HAND
          </SvgText>
          <SvgText
            x={10}
            y={trace3Top + 26}
            fill={COLORS.other}
            fontSize={8}
            fontFamily={FONTS.mono}
          >
            energy
          </SvgText>

          {/* Trace 3 Line */}
          <Path
            d={path3}
            fill="none"
            stroke={COLORS.patterns.still}
            strokeWidth={1.75}
          />

          {/* Bookmark event markers */}
          {bookmarks.map((bm, idx) => {
            if (bm.ts < tMin || bm.ts > tMax) return null;
            const bmX = getX(bm.ts);
            return (
              <G key={`bm-${idx}`}>
                <Line
                  x1={bmX}
                  y1={trace1Top}
                  x2={bmX}
                  y2={trace3Top + traceHeight}
                  stroke={bm.source === 'promise' ? COLORS.patterns.wrap_up : COLORS.paper}
                  strokeWidth={1}
                  strokeDasharray="2 3"
                />
                <Rect
                  x={bmX - 3}
                  y={trace1Top - 5}
                  width={6}
                  height={6}
                  fill={bm.source === 'promise' ? COLORS.patterns.wrap_up : COLORS.paper}
                />
              </G>
            );
          })}

          {/* Vertical scrub cursor */}
          {activePoint && (
            <Line
              x1={scrubX}
              y1={trace1Top - 2}
              x2={scrubX}
              y2={trace3Top + traceHeight + 2}
              stroke={COLORS.paper}
              strokeWidth={1}
            />
          )}

          {/* Time axis hairline */}
          <Line
            x1={padLeft}
            y1={202}
            x2={padLeft + chartWidth}
            y2={202}
            stroke={COLORS.hairline}
            strokeWidth={1}
          />

          {/* Time axis ticks & text */}
          {timeTicks.map((tick) => {
            const x = getX(tick);
            return (
              <G key={`tick-${tick}`}>
                <Line
                  x1={x}
                  y1={202}
                  x2={x}
                  y2={206}
                  stroke={COLORS.hairline}
                  strokeWidth={1}
                />
                <SvgText
                  x={x}
                  y={216}
                  fill={COLORS.inkMid}
                  fontSize={9}
                  fontFamily={FONTS.mono}
                  textAnchor="middle"
                >
                  {formatSec(tick)}
                </SvgText>
              </G>
            );
          })}
        </Svg>
      </View>

      <Text style={styles.legendFootnote}>
        Drag horizontally to inspect pace, volume, and hand energy alignment.
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
    marginBottom: SPACING.sm,
  },
  sectionHeader: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    letterSpacing: 1.5,
    color: COLORS.inkMid,
    textTransform: 'uppercase',
  },
  subHeader: {
    fontFamily: FONTS.mono,
    fontSize: 10,
    letterSpacing: 1,
    color: COLORS.other,
  },
  readoutStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  readoutTime: {
    fontFamily: FONTS.monoMedium,
    fontSize: 12,
    color: COLORS.paper,
    fontVariant: ['tabular-nums'],
  },
  readoutDivider: {
    marginHorizontal: SPACING.xs,
    color: COLORS.other,
    fontSize: 12,
  },
  readoutMetric: {
    fontFamily: FONTS.monoMedium,
    fontSize: 11,
    fontVariant: ['tabular-nums'],
  },
  svgWrapper: {
    marginVertical: SPACING.xs,
  },
  legendFootnote: {
    fontFamily: FONTS.ui,
    fontSize: 11,
    color: COLORS.other,
    marginTop: SPACING.xs,
    textAlign: 'left',
  },
});
