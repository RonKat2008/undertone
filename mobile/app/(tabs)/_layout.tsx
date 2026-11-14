/**
 * Three tabs: Now, Conversations, You. expo-router's real Tabs keep each screen mounted,
 * so switching never refetches or loses scroll. Text tabs only: no icons to decode.
 */
import { Tabs } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBus } from '@/bus/use-bus';
import { T } from '@/ui/kit';
import { C, S } from '@/ui/theme';

const LABELS: Record<string, string> = { index: 'Now', conversations: 'Conversations', you: 'You' };

function TabBar({ state, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { state: bus } = useBus();
  return (
    <View accessibilityRole="tablist" style={[styles.bar, { paddingBottom: Math.max(insets.bottom, S[2]) }]}>
      {state.routes.map((route, i) => {
        const active = state.index === i;
        const label = LABELS[route.name] ?? route.name;
        const unread = route.name === 'conversations' && !!bus.notice;
        const onPress = () => { if (!active) navigateToTab(route.key); };
        return (
          <Pressable key={route.key} onPress={onPress} accessibilityRole="tab" accessibilityState={{ selected: active }}
            accessibilityLabel={unread ? `${label}, new debrief` : label}
            style={({ pressed }) => [styles.tab, pressed && styles.pressed]}>
            <View style={styles.labelRow}>
              <T v="small" strong color={active ? C.text : C.muted}>{label}</T>
              {unread ? <View style={styles.unread} /> : null}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: C.bg }, animation: 'none' }}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="conversations" />
      <Tabs.Screen name="you" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: C.bg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line },
  tab: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  unread: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.accent },
});
