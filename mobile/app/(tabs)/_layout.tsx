import { Slot, usePathname, useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isLive } from '@/bus/reducer';
import { useBus } from '@/bus/use-bus';
import { T } from '@/ui/kit';
import { C, F } from '@/ui/theme';

const TABS = [
  { href: '/', label: 'Today' },
  { href: '/live', label: 'Live' },
  { href: '/history', label: 'History' },
  { href: '/people', label: 'People' },
  { href: '/settings', label: 'Settings' },
] as const;

/** Tabs are text-s sentence case (§3.4): the current one in ink with a 2 px underline. */
export default function TabsLayout() {
  const path = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { state } = useBus();
  const live = isLive(state);
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1 }}><Slot /></View>
      <View accessibilityRole="tablist" style={{ flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.rule, paddingHorizontal: 8, paddingBottom: Math.max(insets.bottom, 6), backgroundColor: C.bg }}>
        {TABS.map((t) => {
          const active = path === t.href;
          return (
            <Pressable key={t.href} onPress={() => router.replace(t.href)} accessibilityRole="tab" accessibilityState={{ selected: active }} accessibilityLabel={t.href === '/live' && live ? 'Live, listening' : t.label}
              style={({ pressed }) => ({ flex: 1, height: 52, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                {t.href === '/live' && live ? <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.fg }} /> : null}
                <View style={{ borderBottomWidth: 2, borderBottomColor: active ? C.fg : 'transparent', paddingBottom: 3 }}>
                  <T v="small" color={active ? C.fg : C.fg2} style={active ? { fontFamily: F.sansMedium } : null}>{t.label}</T>
                </View>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
