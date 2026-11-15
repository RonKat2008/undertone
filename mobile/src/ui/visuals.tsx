/**
 * The visual vocabulary: icons, avatars, small inline charts, the ambient glow and the listening orb.
 * All drawn with react-native-svg and animated with Reanimated (both in Expo Go).
 */
import { useEffect, useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Defs, Path, Polyline, RadialGradient, Rect, Stop } from 'react-native-svg';
import { EASE_IN_OUT, useReduceMotion } from './motion';
import { C, F, hueFor, alpha } from './theme';

// ---------- icons ----------

export type IconName = 'now' | 'talk' | 'you' | 'chevron' | 'apps' | 'pulse' | 'play' | 'pause' | 'bookmark' | 'people' | 'link' | 'check';

const PATHS: Record<IconName, string> = {
  now: 'M12 9.2a2.8 2.8 0 1 1 0 5.6 2.8 2.8 0 0 1 0-5.6ZM6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4M3.5 3.5a12 12 0 0 0 0 17M20.5 3.5a12 12 0 0 1 0 17',
  talk: 'M5 5.5h14a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-8l-4.5 3.5v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5Z',
  you: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20.5a7.5 7.5 0 0 1 15 0',
  chevron: 'M9.5 5.5 16 12l-6.5 6.5',
  apps: 'M4.5 4.5h6v6h-6zM13.5 4.5h6v6h-6zM4.5 13.5h6v6h-6zM13.5 13.5h6v6h-6z',
  pulse: 'M2.5 12h4l2.5-6 5 12 2.5-6h5',
  play: 'M8 5.5v13l10.5-6.5z',
  pause: 'M8 5.5v13M16 5.5v13',
  bookmark: 'M7 4h10v16l-5-4-5 4z',
  people: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM2.5 20a6.5 6.5 0 0 1 13 0M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14a6.5 6.5 0 0 1 3 6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  check: 'M5 12.5 10 17.5 19.5 7',
};

const FILLED: Partial<Record<IconName, boolean>> = { play: true };

export function Icon({ name, size = 22, color = C.text, strokeWidth = 1.8 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const filled = FILLED[name];
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={PATHS[name]} stroke={color} strokeWidth={filled ? 1 : strokeWidth} fill={filled ? color : 'none'} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** An icon in a soft tinted well: the leading mark of a settings row or an empty state. */
export function IconWell({ name, color = C.accent, size = 40 }: { name: IconName; color?: string; size?: number }) {
  return (
    <View style={[vis.well, { width: size, height: size, borderRadius: size * 0.32, backgroundColor: alpha(color, 0.16) }]}>
      <Icon name={name} size={size * 0.52} color={color} />
    </View>
  );
}

// ---------- people ----------

/** A coloured initial. The hue is stable per person, so the same person is always the same colour. */
export function Avatar({ name, id, size = 40 }: { name: string; id?: string; size?: number }) {
  const hue = hueFor(id ?? name);
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  return (
    <View style={[vis.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: alpha(hue, 0.2) }]} aria-hidden>
      <Animated.Text style={[vis.initial, { color: hue, fontSize: size * 0.42, lineHeight: size * 0.5 }]}>{initial}</Animated.Text>
    </View>
  );
}

// ---------- small charts ----------

/** A short horizontal bar: a share (0-1) or a value against a reference. Rounded, in a colour that means something. */
export function Meter({ value, color = C.accent, mark, style }: { value: number; color?: string; mark?: number; style?: StyleProp<ViewStyle> }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <View style={[vis.track, style]} aria-hidden>
      <View style={[vis.fill, { width: `${v * 100}%`, backgroundColor: color }]} />
      {typeof mark === 'number' ? <View style={[vis.mark, { left: `${Math.max(0, Math.min(1, mark)) * 100}%` }]} /> : null}
    </View>
  );
}

/** A sparkline: the shape of a value over time. No axes, no numbers. */
export function Sparkline({ values, width = 120, height = 32, color = C.accent, band }: { values: number[]; width?: number; height?: number; color?: string; band?: [number, number] }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const pts = values.filter((n) => Number.isFinite(n));
  if (pts.length < 2) return null;
  const lo = Math.min(...pts, ...(band ?? []));
  const hi = Math.max(...pts, ...(band ?? []));
  const span = hi - lo || 1;
  const y = (n: number) => 3 + (1 - (n - lo) / span) * (height - 6);
  const line = pts.map((n, i) => `${(i / (pts.length - 1)) * width},${y(n)}`).join(' ');
  return (
    <Svg width={width} height={height}>
      <Defs>
        <RadialGradient id={`b${id}`} cx="50%" cy="50%" r="60%"><Stop offset="0" stopColor={color} stopOpacity={0.14} /><Stop offset="1" stopColor={color} stopOpacity={0.05} /></RadialGradient>
      </Defs>
      {band ? <Rect x={0} y={y(band[1])} width={width} height={Math.max(2, y(band[0]) - y(band[1]))} rx={4} fill={`url(#b${id})`} /> : null}
      <Polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ---------- atmosphere ----------

/** A soft radial glow at the top of a screen, so the page is never flat black. */
export function Ambient({ color = C.accent, strength = 0.22, style }: { color?: string; strength?: number; style?: StyleProp<ViewStyle> }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      <Svg width="100%" height="100%">
        <Defs>
          <RadialGradient id={`a${id}`} cx="50%" cy="0%" rx="85%" ry="55%" fx="50%" fy="0%">
            <Stop offset="0" stopColor={color} stopOpacity={strength} />
            <Stop offset="1" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#a${id})`} />
      </Svg>
    </View>
  );
}

/**
 * The listening orb: a soft glow that breathes in the state colour.
 *   energy 0  still (not listening)      energy 1  slow calm breath (listening)
 *   energy 2  livelier (in a conversation)
 * `pulse` changes on a nudge: the orb swells once.
 */
export function Orb({ color, energy, pulse, size = 220 }: { color: string; energy: 0 | 1 | 2; pulse?: string | null; size?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const reduce = useReduceMotion();
  const breath = useSharedValue(1);
  const bump = useSharedValue(1);

  useEffect(() => {
    cancelAnimation(breath);
    if (reduce || energy === 0) { breath.set(withTiming(1, { duration: 300 })); return; }
    const [to, half] = energy === 2 ? [1.1, 700] : [1.06, 1800];
    breath.set(withRepeat(withSequence(withTiming(to, { duration: half, easing: EASE_IN_OUT }), withTiming(0.94, { duration: half, easing: EASE_IN_OUT })), -1, false));
  }, [energy, reduce, breath]);

  useEffect(() => {
    if (!pulse || reduce) return;
    bump.set(withSequence(withTiming(1.28, { duration: 140 }), withSpring(1, { duration: 600, dampingRatio: 0.6 })));
  }, [pulse, reduce, bump]);

  const halo = useAnimatedStyle(() => ({ transform: [{ scale: breath.get() * bump.get() }] }));
  const core = useAnimatedStyle(() => ({ transform: [{ scale: 0.92 + (breath.get() - 0.94) * 0.5 }] }));
  const coreSize = size * 0.3;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} aria-hidden>
      <Animated.View style={[StyleSheet.absoluteFill, halo]}>
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id={`o${id}`} cx="50%" cy="50%" r="50%">
              <Stop offset="0" stopColor={color} stopOpacity={energy === 0 ? 0.18 : 0.5} />
              <Stop offset="0.45" stopColor={color} stopOpacity={energy === 0 ? 0.08 : 0.2} />
              <Stop offset="1" stopColor={color} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={size / 2} cy={size / 2} r={size / 2} fill={`url(#o${id})`} />
        </Svg>
      </Animated.View>
      <Animated.View style={core}>
        {energy === 0 ? (
          // Not listening: an empty ring, so the orb reads as "off", not as a grey ball.
          <View style={{ width: coreSize, height: coreSize, borderRadius: coreSize / 2, borderWidth: 2, borderColor: alpha(color, 0.6) }} />
        ) : (
          <Svg width={coreSize} height={coreSize}>
            <Defs>
              <RadialGradient id={`c${id}`} cx="38%" cy="32%" r="70%">
                <Stop offset="0" stopColor="#FFFFFF" stopOpacity={0.4} />
                <Stop offset="1" stopColor="#FFFFFF" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            <Circle cx={coreSize / 2} cy={coreSize / 2} r={coreSize / 2 - 1} fill={color} />
            <Circle cx={coreSize / 2} cy={coreSize / 2} r={coreSize / 2 - 1} fill={`url(#c${id})`} />
          </Svg>
        )}
      </Animated.View>
    </View>
  );
}

const vis = StyleSheet.create({
  well: { alignItems: 'center', justifyContent: 'center' },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  initial: { fontFamily: F.sansMedium },
  track: { height: 6, borderRadius: 3, backgroundColor: C.raised, overflow: 'hidden' },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 3 },
  mark: { position: 'absolute', top: -2, bottom: -2, width: 2, marginLeft: -1, backgroundColor: C.text, borderRadius: 1 },
});
