import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { T } from './kit';
import { C, S } from './theme';

/** Title bar for pushed screens (debrief, pattern tester, connected apps). */
export function Header({ title, right }: { title: string; right?: ReactNode }) {
  const router = useRouter();
  return (
    <View style={{ marginBottom: S[5], marginTop: S[1] }}>
      <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityRole="button" accessibilityLabel="Back" hitSlop={12}
        style={({ pressed }) => ({ paddingVertical: S[3], alignSelf: 'flex-start', opacity: pressed ? 0.55 : 1 })}>
        <T v="small" color={C.fg2}>← Back</T>
      </Pressable>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: S[1] }}>
        <T v="displayM">{title}</T>
        {right}
      </View>
    </View>
  );
}
