/**
 * Haptic glyph for the phone: bars on a baseline. Width is duration, height is intensity,
 * spacing is the gap between taps. When `playKey` changes the bars light up in real rhythm.
 */
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';
import Svg, { Line, Polygon, Rect } from 'react-native-svg';
import type { HapticPattern } from '@/bus/contracts';
import { PATTERNS } from '@/bus/patterns';
import { TONE } from './theme';

const MS_PER_HEIGHT = 420;
const ARect = Animated.createAnimatedComponent(Rect);
const APolygon = Animated.createAnimatedComponent(Polygon);

export function glyphWidth(pattern: HapticPattern, size: number): number {
  const k = size / MS_PER_HEIGHT;
  return Math.max(...PATTERNS[pattern].pulses.map((p) => p.at * k + Math.max(p.dur * k, size * 0.11))) + 1;
}

let reduceMotion = false;
AccessibilityInfo.isReduceMotionEnabled().then((v) => { reduceMotion = v; }).catch(() => undefined);
AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => { reduceMotion = v; });

export function Glyph({ pattern, size = 22, color, playKey, maxWidth }: { pattern: HapticPattern; size?: number; color?: string; playKey?: string | number | null; maxWidth?: number }) {
  const spec = PATTERNS[pattern];
  const natural = glyphWidth(pattern, size);
  const scale = maxWidth && natural > maxWidth ? maxWidth / natural : 1;
  const h = size * scale;
  const k = h / MS_PER_HEIGHT;
  const width = natural * scale;
  const fill = color ?? TONE[spec.tone];
  const base = h - 1;
  const values = useRef(spec.pulses.map(() => new Animated.Value(1))).current;
  while (values.length < spec.pulses.length) values.push(new Animated.Value(1));

  useEffect(() => {
    if (playKey === undefined || playKey === null || reduceMotion) return;
    const runs = spec.pulses.map((p, i) => {
      values[i].setValue(0.18);
      return Animated.sequence([
        Animated.delay(p.at),
        Animated.timing(values[i], { toValue: 1, duration: Math.max(90, Math.min(p.dur, 500)), easing: Easing.out(Easing.quad), useNativeDriver: false }),
      ]);
    });
    const all = Animated.parallel(runs);
    all.start();
    return () => { all.stop(); values.forEach((v) => v.setValue(1)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playKey, pattern]);

  return (
    <Svg width={width} height={h} viewBox={`0 0 ${width} ${h}`} accessibilityLabel={`${spec.name}: ${spec.feel}`}>
      <Line x1={0} x2={width} y1={base + 0.5} y2={base + 0.5} stroke={fill} strokeWidth={1} opacity={0.35} />
      {spec.pulses.map((p, i) => {
        const x = p.at * k;
        const w = Math.max(p.dur * k, h * 0.11);
        const ph = Math.max((h - 2) * p.level, 2);
        if (p.shape === 'ramp') return <APolygon key={i} points={`${x},${base} ${x + w},${base} ${x + w},${base - ph}`} fill={fill} opacity={values[i]} />;
        return <ARect key={i} x={x} y={base - ph} width={w} height={ph} rx={p.shape === 'soft' ? Math.min(ph / 2, w / 2) : 0} fill={fill} opacity={values[i]} />;
      })}
    </Svg>
  );
}
