/**
 * Three tabs: Now, Conversations, You. expo-router's real Tabs keep each screen mounted,
 * so switching never refetches or loses scroll. A simple drawn icon and a word per tab.
 */
import { Tabs } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBus } from '@/bus/use-bus';
import { Icon, T, type IconName } from '@/ui/kit';
import { C, S, SHADOW } from '@/ui/theme';

const LABELS: Record<string, string> = { index: 'Now', conversations: 'Conversations', you: 'You' };
const ICONS: Record<string, IconName> = { index: 'now', conversations: 'talk', you: 'you' };

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
            <View>
              <Icon name={ICONS[route.name] ?? 'now'} size={24} color={active ? C.accent : C.muted} />
              {unread ? <View style={styles.unread} /> : null}
            </View>
            <T v="caption" strong color={active ? C.accent : C.muted} style={styles.label}>{label}</T>
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
  bar: { flexDirection: 'row', backgroundColor: C.bgDeep, paddingTop: S[2], ...SHADOW },
  tab: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
  label: { marginTop: 2 },
  unread: { position: 'absolute', top: -1, right: -4, width: 9, height: 9, borderRadius: 5, backgroundColor: C.warm, borderWidth: 2, borderColor: C.bgDeep },
});
