/**
 * The metronome pendulum (DESIGN.md §5.5). It stands still while the wearer is inside the pace band
 * and swings at the wearer's own beat when they rush. It shows state; it never buzzes.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import Svg, { Ellipse, Line } from 'react-native-svg';
import { useReduceMotion } from './motion';
import { C, R, TONE } from './theme';

const TICKS = [-24, -18, -12, -6, 0, 6, 12, 18, 24];
const WEIGHT_W = 22;
const WEIGHT_H = 14;
const RIT_MS = 720; // the slow_down ramp's length
const RIT_HALF = 900; // half-period the swing slows to after the nudge

/** Where the sliding weight sits: baseline 120-200 wpm maps onto 80%-30% of the rod. */
export function weightFraction(baseline: number): number {
  const b = Math.min(200, Math.max(120, baseline));
  return 0.8 - ((b - 120) / 80) * 0.5;
}

/** Swing amplitude in degrees for a pace above the band; 0 inside it. */
export function amplitude(wpm: number, baseline: number, tolerance: number): number {
  const upper = baseline * (1 + tolerance);
  if (wpm <= upper) return 0;
  return Math.min(1, Math.max(0, (wpm - upper) / (0.25 * baseline))) * 16 + 8;
}

export function Metronome({ wpm, baseline, tolerance, rodLength, width, dim, ritFrom }: {
  wpm: number; baseline: number; tolerance: number; rodLength: number; width: number;
  /** Not live: drawn at rest in quiet ink. */
  dim?: boolean;
  /** Wall ms when the slow_down takeover ended: the swing slows to 900 ms over 720 ms. */
  ritFrom?: number | null;
}) {
  const reduce = useReduceMotion();
  const angle = useRef(new Animated.Value(0)).current;
  const target = dim ? 0 : amplitude(wpm, baseline, tolerance);
  const rushing = target > 0;
  const [swinging, setSwinging] = useState(false);
  const live = useRef({ target, half: 120000 / Math.max(wpm, 1), ritFrom: ritFrom ?? null });
  live.current = { target, half: rushing ? 120000 / wpm : live.current.half, ritFrom: ritFrom ?? null };

  // Reduced motion: never swings; tilts statically to +14° while rushing (§5.4).
  useEffect(() => {
    if (!reduce) return;
    angle.setValue(rushing ? 14 : 0);
    setSwinging(rushing);
  }, [reduce, rushing, angle]);

  useEffect(() => {
    if (reduce) return;
    let amp = 0;
    let phase = 0;
    let last = 0;
    let frame = 0;
    let shown = false;
    let value = 0;
    const tick = (t: number) => {
      const dt = last ? Math.min(64, t - last) : 16;
      last = t;
      const { target: goal, ritFrom: rit } = live.current;
      let half = live.current.half;
      const since = rit ? Date.now() - rit : -1;
      if (since >= 0 && since <= RIT_MS) half = half + (RIT_HALF - half) * (since / RIT_MS);
      // Entering the swing eases in over ~600 ms; leaving decays over about two half-swings.
      const tau = goal > amp ? 200 : (half * 2) / 3;
      amp += (goal - amp) * Math.min(1, dt / tau);
      if (goal === 0 && amp < 0.15) amp = 0;
      phase = amp === 0 ? 0 : phase + (dt * Math.PI) / half;
      const next = amp * Math.sin(phase);
      if (next !== value) { value = next; angle.setValue(next); }
      const on = goal > 0 || amp > 1.5;
      if (on !== shown) { shown = on; setSwinging(on); }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduce, angle]);

  const ink = dim ? C.ruleStrong : swinging || (reduce && rushing) ? TONE.blue.solid : C.fg;
  const px = width / 2;
  const py = 6;
  const tickR = rodLength + 10;
  const frac = weightFraction(baseline);
  const rotate = angle.interpolate({ inputRange: [-90, 90], outputRange: ['-90deg', '90deg'] });
  const height = py + tickR + 20;

  return (
    <View style={{ width, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={width} height={height} style={{ position: 'absolute', left: 0, top: 0 }}>
        {TICKS.map((a) => {
          const r = (a * Math.PI) / 180;
          const len = a === 0 ? 16 : 10;
          return (
            <Line key={a} x1={px + Math.sin(r) * tickR} y1={py + Math.cos(r) * tickR} x2={px + Math.sin(r) * (tickR + len)} y2={py + Math.cos(r) * (tickR + len)}
              stroke={a === 0 ? C.fg3 : C.ruleStrong} strokeWidth={a === 0 ? 1.5 : 1} />
          );
        })}
      </Svg>
      {/* The rod and its weight rotate about the pivot: a box twice the rod's length, centred on it. */}
      <Animated.View style={{ position: 'absolute', left: px - WEIGHT_W / 2, top: py - rodLength, width: WEIGHT_W, height: rodLength * 2, transform: [{ rotate }] }}>
        <View style={{ position: 'absolute', left: WEIGHT_W / 2 - 1.5, top: rodLength, width: 3, height: rodLength, backgroundColor: ink }} />
        <View style={{ position: 'absolute', left: 0, top: rodLength + frac * rodLength - WEIGHT_H / 2, width: WEIGHT_W, height: WEIGHT_H, borderRadius: R.key, backgroundColor: ink }} />
      </Animated.View>
      <View style={{ position: 'absolute', left: px - 7, top: py - 7, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: ink, backgroundColor: C.bg }} />
    </View>
  );
}

/** The tempo marking's quarter note, drawn (fonts rarely carry ♩). */
export function QuarterNote({ size = 22, color = C.fg }: { size?: number; color?: string }) {
  const w = size * 0.55;
  const cx = w * 0.42;
  const cy = size * 0.82;
  return (
    <Svg width={w} height={size}>
      <Ellipse cx={cx} cy={cy} rx={size * 0.19} ry={size * 0.13} fill={color} transform={`rotate(-20 ${cx} ${cy})`} />
      <Line x1={cx + size * 0.17} y1={cy - size * 0.03} x2={cx + size * 0.17} y2={size * 0.06} stroke={color} strokeWidth={Math.max(1.2, size * 0.065)} />
    </Svg>
  );
}

/** Buzzes left: noteheads, filled `blue` while available, a hollow ring once spent (§5.5). */
export function Budget({ left, total }: { left: number; total: number }) {
  const n = Math.min(total, 8);
  return (
    <View accessibilityLabel={`${left} of ${total} buzzes left`} style={{ flexDirection: 'row', gap: 4 }}>
      {Array.from({ length: n }, (_, i) => {
        const spent = i >= left;
        return (
          <Svg key={i} width={14} height={12}>
            <Ellipse cx={7} cy={6} rx={spent ? 5 : 5.5} ry={spent ? 3.4 : 4} fill={spent ? 'none' : TONE.blue.solid} stroke={spent ? C.fg3 : 'none'} strokeWidth={1.2} transform="rotate(-20 7 6)" />
          </Svg>
        );
      })}
    </View>
  );
}
