import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useBus } from '@/bus/use-bus';
import { Btn, Label, Screen, StateMark, T } from '@/ui/kit';
import { C, F, S } from '@/ui/theme';

function LinkRow({ title, note, onPress, badge }: { title: string; note: string; onPress: () => void; badge?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="link" style={({ pressed }) => ({ borderBottomWidth: 1, borderBottomColor: C.rule, paddingVertical: S[5], opacity: pressed ? 0.55 : 1 })}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <T v="displayS">{title}</T>
        {badge ? <T v="small" color={C.fg} style={{ fontFamily: F.sansMedium }}>{badge}</T> : <T v="body" color={C.fg3}>→</T>}
      </View>
      <T v="small" style={{ marginTop: S[1] }}>{note}</T>
    </Pressable>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { mode, pairing, state, unpair, alwaysOnDemo, setAlwaysOnDemo } = useBus();
  const pending = state.appRequests.length;
  const connected = mode !== 'mock' && state.status === 'live';
  return (
    <Screen title="Settings">
      <View style={{ borderTopWidth: 1, borderTopColor: C.rule }}>
        <LinkRow title="Pattern tester" note="Feel all eleven patterns and learn what each one asks of you." onPress={() => router.push('/patterns')} />
        <LinkRow title="Connected apps" note="Other apps and websites that may tap you through Undertone." onPress={() => router.push('/apps')} badge={pending ? `${pending} waiting` : undefined} />
      </View>

      <Label style={{ marginTop: S[7] }}>This phone</Label>
      {/* Neutral state marks (§2.4): a hollow ring when idle, a dot when connected, a dashed ring when offline. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: S[3], marginTop: S[3] }}>
        <StateMark kind={mode === 'mock' ? 'off' : connected ? 'on' : 'fault'} size={14} />
        <T v="displayS">{mode === 'mock' ? 'Demo pairing' : connected ? 'Connected to the laptop' : 'Laptop unreachable'}</T>
        {mode !== 'mock' && !connected ? <T v="body" style={{ fontFamily: F.sansMedium }}>Offline</T> : null}
      </View>
      {mode === 'mock'
        ? <T v="small" style={{ marginTop: S[1], marginLeft: 14 + S[3] }}>A scripted conversation, on a loop. No network.</T>
        : <T v="numS" color={C.fg2} style={{ marginTop: S[2], marginLeft: 14 + S[3] }}>{pairing ? `${pairing.server_url}\n${pairing.device_id}` : process.env.EXPO_PUBLIC_BUS_URL ?? ''}</T>}
      <T v="small" style={{ marginTop: S[4] }}>{state.alwaysOn
        ? 'Always on: the band listens all day and conversations open by themselves. Buzzes only arrive while Undertone is open on screen; the screen stays awake during a conversation and may sleep between them. Open Undertone again to catch up.'
        : 'Buzzes only arrive while Undertone is open on screen. The Live tab keeps the screen awake.'}</T>
      {mode === 'mock' ? (
        <Btn small label={alwaysOnDemo ? 'Demo: always-on day (switch to tap to start)' : 'Demo: tap to start (switch to always-on day)'} onPress={() => setAlwaysOnDemo(!alwaysOnDemo)} style={{ marginTop: S[4] }} />
      ) : null}
      <Btn label={mode === 'mock' ? 'Pair with a laptop' : 'Unpair this phone'} onPress={() => void unpair()} style={{ marginTop: S[5] }} />
      <T v="small" color={C.fg3} style={{ marginTop: S[6] }}>Three fingers on the screen opens the rehearsal panel.</T>
    </Screen>
  );
}
