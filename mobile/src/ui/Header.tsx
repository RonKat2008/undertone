import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { T } from './kit';
import { C } from './theme';

/** Title bar for pushed screens (debrief, pattern tester, connected apps). */
export function Header({ title, right }: { title: string; right?: ReactNode }) {
  const router = useRouter();
  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: C.paper, paddingBottom: 8, marginBottom: 18, marginTop: 2 }}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12} style={{ paddingVertical: 8, alignSelf: 'flex-start' }}>
        <T v="caps" color={C.paper}>← Back</T>
      </Pressable>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <T v="serif" size={38}>{title}</T>
        {right}
      </View>
    </View>
  );
}
