import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useBus } from '@/bus/use-bus';
import { Btn, Screen, T } from '@/ui/kit';
import { C, TONE } from '@/ui/theme';

function LinkRow({ title, note, onPress, badge }: { title: string; note: string; onPress: () => void; badge?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" style={({ pressed }) => ({ borderBottomWidth: 1, borderBottomColor: C.rule, paddingVertical: 18, opacity: pressed ? 0.55 : 1 })}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <T v="serif" size={32}>{title}</T>
        {badge ? <View style={{ borderWidth: 1, borderColor: C.paper, paddingHorizontal: 8, paddingVertical: 2 }}><T v="caps" color={C.paper}>{badge}</T></View> : <T v="mono" color={C.paper3}>→</T>}
      </View>
      <T v="small" style={{ marginTop: 4 }}>{note}</T>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { mode, pairing, state, unpair } = useBus();
  const pending = state.appRequests.length;
  return (
    <Screen title="Settings">
      <LinkRow title="Pattern tester" note="Feel all eleven patterns and learn what each one asks of you." onPress={() => router.push('/patterns')} />
      <LinkRow title="Connected apps" note="Other apps and websites that may tap you through Undertone." onPress={() => router.push('/apps')} badge={pending ? `${pending} waiting` : undefined} />

      <T v="caps" style={{ marginTop: 28 }}>This phone</T>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
        <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: mode === 'mock' ? C.paper3 : state.status === 'live' ? TONE.green : TONE.vermilion }} />
        <T v="serif" size={26}>{mode === 'mock' ? 'Demo pairing' : state.status === 'live' ? 'Connected to the laptop' : 'Laptop unreachable'}</T>
      </View>
      <T v="mono" size={12.5} color={C.paper2} style={{ marginTop: 6 }}>{pairing ? `${pairing.server_url}\n${pairing.device_id}` : mode === 'mock' ? 'A scripted conversation, on a loop. No network.' : process.env.EXPO_PUBLIC_BUS_URL ?? ''}</T>
      <T v="small" style={{ marginTop: 10 }}>Buzzes only arrive while Undertone is open on screen. The Live tab keeps the screen awake.</T>
      <Btn label={mode === 'mock' ? 'Pair with a laptop' : 'Unpair this phone'} onPress={() => void unpair()} style={{ marginTop: 18 }} />
      <T v="small" style={{ marginTop: 22, textAlign: 'center' }}>Three fingers on the screen opens the rehearsal panel.</T>
    </Screen>
  );
}
