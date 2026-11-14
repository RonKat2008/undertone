import { Slot, usePathname, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isLive } from '@/bus/reducer';
import { useBus } from '@/bus/use-bus';
import { T } from '@/ui/kit';
import { C } from '@/ui/theme';

const TABS = [
  { href: '/', label: 'Today' },
  { href: '/live', label: 'Live' },
  { href: '/history', label: 'History' },
  { href: '/people', label: 'People' },
  { href: '/settings', label: 'Settings' },
] as const;

export default function TabsLayout() {
  const path = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state } = useBus();
  const live = isLive(state);
  return (
    <View style={{ flex: 1, backgroundColor: C.ink }}>
      <View style={{ flex: 1 }}><Slot /></View>
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.rule, paddingBottom: Math.max(insets.bottom, 10), backgroundColor: C.ink }}>
        {TABS.map((t) => {
          const active = path === t.href;
          return (
            <Pressable key={t.href} onPress={() => router.replace(t.href)} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={t.label}
              style={({ pressed }) => ({ flex: 1, height: 56, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
              <View style={{ height: 2, width: 22, backgroundColor: active ? C.paper : 'transparent', marginBottom: 9 }} />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                {t.href === '/live' && live ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.mic }} /> : null}
                <T v="caps" size={10.5} color={active ? C.paper : C.paper3}>{t.label}</T>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
