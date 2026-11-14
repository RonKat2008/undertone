/**
 * Haptic glyph as rhythm notation (DESIGN.md §7), drawn from the same Pulse[] the player plays.
 * Time runs left to right at k = H / 420 px per ms; pitch is intensity (harder sits higher).
 * When `playKey` changes, every element animates at its pulse's real millisecond timing (§5.2).
 */
import { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import Svg, { Ellipse, Circle, Line, Path, Polyline, Rect, Text as SvgText } from 'react-native-svg';
import type { HapticPattern } from '@/bus/contracts';
import { PATTERNS, type Pulse } from '@/bus/patterns';
import { reduceMotionNow } from './motion';
import { EASE, F, TONE } from './theme';

const MS_PER_HEIGHT = 420;
const TOP = 0.2; // headroom for stems and accents, as a fraction of H
const DONE = 1e7; // clock value that shows the final frame

const AEllipse = Animated.createAnimatedComponent(Ellipse);
const ACircle = Animated.createAnimatedComponent(Circle);
const ALine = Animated.createAnimatedComponent(Line);
const ARect = Animated.createAnimatedComponent(Rect);
const APath = Animated.createAnimatedComponent(Path);
const APolyline = Animated.createAnimatedComponent(Polyline);
const AText = Animated.createAnimatedComponent(SvgText);

type Kind = 'staccato' | 'short' | 'held' | 'soft' | 'ramp';

function kindOf(p: Pulse): Kind {
  if (p.shape === 'ramp') return 'ramp';
  if (p.shape === 'soft') return 'soft';
  if (p.dur < 35) return 'staccato';
  if (p.dur >= 200) return 'held';
  return 'short';
}

interface Layout {
  width: number;
  height: number;
  k: number;
  y0: number;
  pad: number;
}

/** Natural layout for glyph height H. */
function layout(pattern: HapticPattern, H: number, rit = true): Layout {
  const k = H / MS_PER_HEIGHT;
  const pad = Math.max(1, 0.05 * H);
  let right = 0;
  for (const p of PATTERNS[pattern].pulses) {
    const x0 = pad + p.at * k;
    const kind = kindOf(p);
    if (kind === 'ramp') right = Math.max(right, x0 + p.dur * k + (rit && H >= 48 ? 0.1 * H + 0.75 * H : 0));
    else if (kind === 'soft') right = Math.max(right, x0 + 0.4 * H, x0 + 0.2 * H + p.dur * k);
    else if (kind === 'held') right = Math.max(right, x0 + 0.3 * H, x0 + p.dur * k);
    else if (kind === 'staccato') right = Math.max(right, x0 + 0.12 * H);
    else right = Math.max(right, x0 + 0.3 * H + (p.level >= 0.9 ? 0.06 * H : 0));
  }
  return { width: right + pad, height: H * (TOP + 0.9), k, y0: H * (TOP + 0.82), pad };
}

export function glyphWidth(pattern: HapticPattern, size: number): number {
  return layout(pattern, size).width;
}

export function Glyph({ pattern, size = 22, color, playKey, maxWidth, rit = true }: {
  pattern: HapticPattern; size?: number; color?: string; playKey?: string | number | null; maxWidth?: number;
  /** Write *rit.* after the slow_down hairpin at H ≥ 48 (off when the message beside it already says it). */
  rit?: boolean;
}) {
  const spec = PATTERNS[pattern];
  const natural = layout(pattern, size, rit);
  const H = maxWidth && natural.width > maxWidth ? (size * maxWidth) / natural.width : size;
  const L = H === size ? natural : layout(pattern, H, rit);
  const fill = color ?? TONE[spec.tone].solid;
  const clock = useRef(new Animated.Value(DONE)).current;

  useEffect(() => {
    if (playKey === undefined || playKey === null || reduceMotionNow()) { clock.setValue(DONE); return; }
    clock.setValue(0);
    const end = spec.total + 400;
    const run = Animated.timing(clock, { toValue: end, duration: end, easing: Easing.linear, useNativeDriver: false });
    run.start(({ finished }) => { if (finished) clock.setValue(DONE); });
    return () => { run.stop(); clock.setValue(DONE); };
  }, [playKey, pattern, clock, spec.total]);

  const parts = useMemo(() => spec.pulses.map((p, i) => <Note key={i} p={p} H={H} L={L} fill={fill} clock={clock} rit={rit} />), [spec, H, L, fill, clock, rit]);

  return (
    <Svg width={L.width} height={L.height} viewBox={`0 0 ${L.width} ${L.height}`} accessibilityLabel={`${spec.name}: ${spec.feel}`}>
      <Line x1={0} x2={L.width} y1={L.y0} y2={L.y0} stroke={fill} strokeWidth={1} opacity={0.35} />
      {parts}
    </Svg>
  );
}

/** Interpolate the shared clock (ms) over [from, to]; clamped both sides. */
function over(clock: Animated.Value, inputRange: number[], outputRange: number[], easing?: (t: number) => number) {
  return clock.interpolate({ inputRange, outputRange, extrapolate: 'clamp', easing });
}

function Note({ p, H, L, fill, clock, rit }: { p: Pulse; H: number; L: Layout; fill: string; clock: Animated.Value; rit: boolean }) {
  const kind = kindOf(p);
  const x0 = L.pad + p.at * L.k;
  const filled = p.level >= 0.55;
  const cy = L.y0 - p.level * 0.46 * H;
  const strikeDur = kind === 'short' || kind === 'staccato' ? Math.max(p.dur, 120) : 120;
  const s = over(clock, [p.at, p.at + strikeDur * 0.55, p.at + strikeDur], [0.6, 1.08, 1]);
  const op = over(clock, [p.at, p.at + strikeDur], [0.25, 1], EASE.enter);

  if (kind === 'staccato') {
    const r = 0.06 * H;
    return <ACircle cx={x0 + r} cy={cy} r={Animated.multiply(s, r)} fill={fill} opacity={op} />;
  }

  if (kind === 'ramp') {
    const ay = L.y0 - 0.22 * H;
    const x2 = x0 + p.dur * L.k;
    const open = p.level * 0.25 * H;
    const t = over(clock, [p.at, p.at + p.dur], [0, 1]);
    const ex = t.interpolate({ inputRange: [0, 1], outputRange: [x0, x2] });
    const up = t.interpolate({ inputRange: [0, 1], outputRange: [ay, ay - open] });
    const down = t.interpolate({ inputRange: [0, 1], outputRange: [ay, ay + open] });
    const sw = 0.06 * H;
    const ritOp = over(clock, [p.at, p.at + 120], [0, 1]);
    return (
      <>
        <ALine x1={x0} y1={ay} x2={ex} y2={up} stroke={fill} strokeWidth={sw} strokeLinecap="round" />
        <ALine x1={x0} y1={ay} x2={ex} y2={down} stroke={fill} strokeWidth={sw} strokeLinecap="round" />
        {rit && H >= 48 ? (
          <AText x={x2 + 0.1 * H} y={ay + 0.1 * H} fill={fill} fontSize={0.3 * H} fontFamily={F.monoItalic} opacity={ritOp}>rit.</AText>
        ) : null}
      </>
    );
  }

  const soft = kind === 'soft';
  const rx = (soft ? 0.2 : 0.15) * H;
  const ry = 0.105 * H;
  const cx = x0 + rx;
  const sw = (soft ? 0.05 : 0.06) * H;
  const head = (
    <AEllipse
      cx={cx} cy={cy} rx={Animated.multiply(s, filled && !soft ? rx : rx - sw / 2)} ry={Animated.multiply(s, filled && !soft ? ry : ry - sw / 2)}
      fill={filled && !soft ? fill : 'none'} stroke={filled && !soft ? 'none' : fill} strokeWidth={sw}
      transform={`rotate(-20 ${cx} ${cy})`} opacity={op}
    />
  );

  if (soft) {
    // A whole note, no stem, with a thin tie drawn over the pulse's length.
    const tx1 = cx - rx * 0.2;
    const tx2 = cx + rx * 0.2 + p.dur * L.k;
    const ty = cy + ry + 0.05 * H;
    const sag = 0.09 * H;
    const len = (tx2 - tx1) * 1.12;
    const dash = over(clock, [p.at, p.at + p.dur], [len, 0]);
    return (
      <>
        {head}
        <APath d={`M ${tx1} ${ty} Q ${(tx1 + tx2) / 2} ${ty + sag * 2} ${tx2} ${ty}`} fill="none" stroke={fill} strokeWidth={0.04 * H} strokeLinecap="round"
          strokeDasharray={[len, len]} strokeDashoffset={dash} />
      </>
    );
  }

  const edge = cx + rx * 0.93;
  if (kind === 'held') {
    // No stem: a tenuto bar from the head's right edge, drawn over exactly `dur` ms.
    const full = Math.max(0, x0 + p.dur * L.k - edge);
    const w = over(clock, [p.at, p.at + p.dur], [0, full]);
    const th = 0.09 * H;
    return (
      <>
        <ARect x={edge - 0.5} y={cy - th / 2} width={w} height={th} fill={fill} />
        {head}
      </>
    );
  }

  // Short pulse: head + stem; accent wedge when level ≥ .9.
  const stemW = 0.05 * H;
  const stemX = edge - stemW / 2;
  const stemTop = cy - 0.34 * H;
  const accent = p.level >= 0.9;
  const aOp = over(clock, [p.at, p.at + 60, p.at + 120, p.at + 240], [0, 1, 0.7, 1]);
  const aw = 0.18 * H;
  const ah = 0.09 * H;
  const ay = stemTop - 0.1 * H;
  const ax = stemX - aw / 2;
  return (
    <>
      <ALine x1={stemX} y1={cy - 0.02 * H} x2={stemX} y2={stemTop} stroke={fill} strokeWidth={stemW} opacity={op} />
      {head}
      {accent ? (
        <APolyline points={`${ax},${ay - ah} ${ax + aw},${ay} ${ax},${ay + ah}`} fill="none" stroke={fill} strokeWidth={0.045 * H} strokeLinejoin="miter" opacity={aOp} />
      ) : null}
    </>
  );
}
