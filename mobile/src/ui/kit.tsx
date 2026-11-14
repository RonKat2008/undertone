import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View, type StyleProp, type TextProps, type TextStyle, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { C, F } from './theme';

type Variant = 'body' | 'small' | 'caps' | 'serif' | 'mono';

const BASE: Record<Variant, TextStyle> = {
  body: { fontFamily: F.sans, fontSize: 16, lineHeight: 23, color: C.paper },
  small: { fontFamily: F.sans, fontSize: 13.5, lineHeight: 19, color: C.paper2 },
  caps: { fontFamily: F.sansMedium, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: C.paper2 },
  serif: { fontFamily: F.serif, fontSize: 30, lineHeight: 33, color: C.paper },
  mono: { fontFamily: F.mono, fontSize: 15, color: C.paper, fontVariant: ['tabular-nums'] },
};

export function T({ v = 'body', size, color, style, ...rest }: TextProps & { v?: Variant; size?: number; color?: string }) {
  const sized: TextStyle = size ? { fontSize: size, lineHeight: Math.round(size * (v === 'serif' ? 1.06 : v === 'mono' ? 1.05 : 1.4)) } : {};
  return <Text {...rest} style={[BASE[v], sized, color ? { color } : null, style]} />;
}

export function Screen({ children, scroll = true, style, title, right }: { children: ReactNode; scroll?: boolean; style?: StyleProp<ViewStyle>; title?: string; right?: ReactNode }) {
  const body = (
    <View style={[{ paddingHorizontal: 20, paddingBottom: 28 }, style]}>
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: C.paper, paddingBottom: 8, marginBottom: 18, marginTop: 6 }}>
          <T v="serif" size={38}>{title}</T>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.ink }} edges={['top', 'left', 'right']}>
      {scroll ? <ScrollView contentContainerStyle={{ flexGrow: 1 }} showsVerticalScrollIndicator={false}>{body}</ScrollView> : <View style={{ flex: 1 }}>{body}</View>}
    </SafeAreaView>
  );
}

export function Rule({ strong, style }: { strong?: boolean; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ height: 1, backgroundColor: strong ? C.paper : C.rule }, style]} />;
}

export function Btn({ label, onPress, solid, small, disabled, color, style, accessibilityLabel }: {
  label: string; onPress: () => void; solid?: boolean; small?: boolean; disabled?: boolean; color?: string; style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  const edge = color ?? C.paper;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [{
        minHeight: small ? 40 : 56, paddingHorizontal: small ? 14 : 22, alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: edge, borderRadius: 3, backgroundColor: solid ? edge : 'transparent',
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1, transform: [{ scale: pressed ? 0.98 : 1 }],
      }, style]}
    >
      <T v="body" size={small ? 14 : 17} style={{ fontFamily: F.sansMedium, color: solid ? C.ink : edge }}>{label}</T>
    </Pressable>
  );
}

export function Row({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center' }, style]}>{children}</View>;
}

export function clock(seconds: number | null | undefined): string {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return '0:00';
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
