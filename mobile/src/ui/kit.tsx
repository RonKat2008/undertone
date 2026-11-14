import { Children, useEffect, useRef, type ReactNode } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useReduceMotion } from './motion';
import { C, DUR, F, R, S, SHOW_SAMPLE_LABELS, STATE } from './theme';

/**
 * Type roles (DESIGN.md §3.2, phone column).
 * display*: Newsreader. textL/body/small: Ronzino. label: Ronzino 500 in real small caps.
 * num*: IBM Plex Mono, every number that changes.
 */
export type Variant =
  | 'displayXl' | 'displayL' | 'displayM' | 'displayS'
  | 'textL' | 'body' | 'small' | 'label'
  | 'numXl' | 'numL' | 'numM' | 'numS';

const SERIF = (size: number, lh: number): TextStyle => ({ fontFamily: size >= 40 ? F.serifLight : F.serif, fontSize: size, lineHeight: lh, color: C.fg, fontVariant: ['tabular-nums', 'lining-nums'] });
const MONO = (size: number, lh: number): TextStyle => ({ fontFamily: F.mono, fontSize: size, lineHeight: lh, color: C.fg, fontVariant: ['tabular-nums', 'lining-nums'] });

const BASE: Record<Variant, TextStyle> = {
  displayXl: SERIF(64, 59),
  displayL: SERIF(40, 42),
  displayM: SERIF(30, 32),
  displayS: SERIF(22, 26),
  textL: { fontFamily: F.sans, fontSize: 18, lineHeight: 26, color: C.fg },
  body: { fontFamily: F.sans, fontSize: 16, lineHeight: 23, color: C.fg },
  small: { fontFamily: F.sans, fontSize: 14, lineHeight: 20, color: C.fg2 },
  // Real small caps (smcp) from lowercase source; no tracked uppercase anywhere.
  label: { fontFamily: F.sansMedium, fontSize: 14, lineHeight: 17, letterSpacing: 0.7, color: C.fg2, fontVariant: ['small-caps'] },
  numXl: MONO(88, 80),
  numL: MONO(44, 44),
  numM: MONO(22, 26),
  numS: MONO(13, 17),
};

const LINE: Record<'serif' | 'sans' | 'mono', number> = { serif: 1.1, sans: 1.42, mono: 1.15 };
const family = (v: Variant) => (v.startsWith('display') ? 'serif' : v.startsWith('num') ? 'mono' : 'sans');

function italicFace(v: Variant, size: number): string {
  const fam = family(v);
  if (fam === 'serif') return size >= 40 ? F.serifLightItalic : F.serifItalic;
  if (fam === 'mono') return F.monoItalic;
  return F.sansOblique;
}

export function T({ v = 'body', size, color, italic, style, children, ...rest }: TextProps & { v?: Variant; size?: number; color?: string; italic?: boolean }) {
  const base = BASE[v];
  const px = size ?? (base.fontSize as number);
  const sized: TextStyle = size ? {
    fontSize: size, lineHeight: Math.round(size * LINE[family(v)]),
    ...(family(v) === 'serif' ? { fontFamily: size >= 40 ? F.serifLight : F.serif } : null),
  } : {};
  const face: TextStyle | null = italic ? { fontFamily: italicFace(v, px) } : null;
  // Labels are written lowercase so smcp renders every letter as a small capital.
  const body = v === 'label' ? Children.map(children, (c) => (typeof c === 'string' ? c.toLowerCase() : c)) : children;
  return <Text {...rest} style={[base, sized, face, color ? { color } : null, style]}>{body}</Text>;
}

export function Screen({ children, scroll = true, style, title, right }: { children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle>; title?: string; right?: ReactNode }) {
  const body = (
    <View style={[{ paddingHorizontal: 20, paddingBottom: S[7] }, style]}>
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: S[5], marginBottom: S[5] }}>
          <T v="displayM">{title}</T>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top', 'left', 'right']}>
      {scroll ? <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>{body}</ScrollView> : <View style={{ flex: 1 }}>{body}</View>}
    </SafeAreaView>
  );
}

/** A hairline. `emphasis` is the one 2 px ink rule a page may have (§4.4). */
export function Rule({ emphasis, style }: { emphasis?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: emphasis ? 2 : 1, backgroundColor: emphasis ? C.fg : C.rule }, style]} />;
}

/** A key: the instrument's button. 4 px radius, 1 px rule-strong border, at least 48 px tall. */
export function Btn({ label, onPress, solid, small, disabled, style, accessibilityLabel }: {
  label: string; onPress: () => void; solid?: boolean; small?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [{
        minHeight: small ? 48 : 56, paddingHorizontal: small ? 16 : 22, alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: solid ? C.fg : C.ruleStrong, borderRadius: R.key,
        backgroundColor: solid ? (pressed ? C.fg2 : C.fg) : pressed ? C.rule : C.well,
        opacity: disabled ? 0.4 : 1,
      }, style]}
    >
      <T v="body" style={{ fontFamily: F.sansMedium, color: solid ? C.bg : C.fg }}>{label}</T>
    </Pressable>
  );
}

/** An inline text link: text-m, underlined, ink. */
export function Link({ label, onPress, style, color = C.fg }: { label: string; onPress: () => void; style?: StyleProp<ViewStyle>; color?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" hitSlop={8} style={({ pressed }) => [{ alignSelf: 'flex-start', paddingVertical: S[2], opacity: pressed ? 0.55 : 1 }, style]}>
      <T v="body" color={color} style={{ textDecorationLine: 'underline' }}>{label}</T>
    </Pressable>
  );
}

export function SampleTag({ show = true }: { show?: boolean }) {
  if (!SHOW_SAMPLE_LABELS || !show) return null;
  return (
    <View style={{ borderWidth: 1, borderStyle: 'dashed', borderColor: C.ruleStrong, paddingHorizontal: 6, paddingBottom: 2 }}>
      <T v="label" size={13} style={{ lineHeight: 16 }}>sample</T>
    </View>
  );
}

/** A short label (≤ 3 words) with an optional sample tag beside it. */
export function Label({ children, sample, color, style }: { children: string; sample?: boolean; color?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: S[3] }, style]}>
      <T v="label" color={color}>{children}</T>
      <SampleTag show={sample ?? false} />
    </View>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

/**
 * System state marks (§2.4): neutral shapes, never a pattern hue.
 * listening: an ink dot in a ring that breathes (the only idle loop); on: a filled dot;
 * off: a hollow ring; fault: a dashed ring.
 */
export function StateMark({ kind, size = 12, color = C.fg }: { kind: 'listening' | 'on' | 'off' | 'fault'; size?: number; color?: string }) {
  const reduce = useReduceMotion();
  const breath = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (kind !== 'listening' || reduce) { breath.setValue(1); return; }
    const half = DUR.breath / 2;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breath, { toValue: 0.35, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      Animated.timing(breath, { toValue: 1, duration: half, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [kind, reduce, breath]);
  const ring: ViewStyle = { position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 1, borderColor: kind === 'off' ? STATE.off : color };
  const dot = Math.round(size * 0.42);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }} accessibilityElementsHidden importantForAccessibility="no">
      {kind === 'listening' ? <Animated.View style={[ring, { opacity: breath }]} /> : null}
      {kind === 'off' ? <View style={ring} /> : null}
      {kind === 'fault' ? <View style={[ring, { borderStyle: 'dashed' }]} /> : null}
      {kind === 'listening' || kind === 'on' ? <View style={{ width: kind === 'on' ? Math.round(size * 0.6) : dot, height: kind === 'on' ? Math.round(size * 0.6) : dot, borderRadius: size, backgroundColor: color }} /> : null}
    </View>
  );
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** "Saturday 14 November": sentence case, no commas (§9 Today). */
export function longDate(d: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}
