/** Always-on: the Live tab between conversations. Says plainly what is listening and what is not. */
import { useKeepAwake } from 'expo-keep-awake';
import { Pressable, View } from 'react-native';
import type { ListenState, PhoneState } from '@/bus/phone-state';
import { T, clock } from './kit';
import { C, F, TONE } from './theme';

/** Mount to hold the screen awake; unmount to let it sleep. */
export function StayAwake() {
  useKeepAwake();
  return null;
}

export const LISTEN_LABEL: Record<ListenState, string> = {
  connecting: 'Connecting to the laptop',
  offline: 'Laptop unreachable',
  'no-band': 'Band not connected',
  'mic-off': 'Band mic off',
  listening: 'Listening',
  'in-conversation': 'In a conversation',
};

const HEADLINE: Record<Exclude<ListenState, 'in-conversation'>, string> = {
  connecting: 'Connecting…',
  offline: 'Not listening.',
  'no-band': 'Band not connected.',
  'mic-off': 'The mic is off.',
  listening: 'Listening.',
};

const EXPLAIN: Record<Exclude<ListenState, 'in-conversation'>, string> = {
  connecting: 'Finding the laptop on this Wi-Fi.',
  offline: 'The phone cannot reach the laptop, so nothing is being heard or coached. It keeps retrying; check the laptop and the Wi-Fi.',
  'no-band': 'The laptop is up but the band is not talking to it. Nothing is being heard.',
  'mic-off': 'The band is connected but its microphone is off. Nothing is being heard.',
  listening: 'A conversation opens by itself when someone talks to you, and closes when it ends. No tap needed.',
};

export function dotColor(s: ListenState): string {
  if (s === 'offline') return TONE.vermilion;
  if (s === 'listening' || s === 'in-conversation') return C.mic;
  if (s === 'connecting') return C.paper3;
  return TONE.amber;
}

function Line({ label, value, ok }: { label: string; value: string; ok: boolean | null }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.rule, paddingVertical: 9 }}>
      <T v="caps" style={{ width: 70 }}>{label}</T>
      <View style={{ width: 7, height: 7, borderRadius: 4, marginRight: 8, backgroundColor: ok === null ? C.paper3 : ok ? TONE.green : TONE.vermilion }} />
      <T v="small" color={C.paper} style={{ flex: 1 }}>{value}</T>
    </View>
  );
}

interface Props {
  state: PhoneState;
  listen: ListenState;
  isDemo: boolean;
  onOpenDebrief: () => void;
}

export function ListeningIdle({ state, listen, isDemo, onOpenDebrief }: Props) {
  const idle = listen === 'in-conversation' ? 'listening' : listen;
  const reachable = listen !== 'offline' && listen !== 'connecting';
  const band = state.band;
  // when the laptop is unreachable, the band and mic values are stale: say so instead of showing them
  const bandValue = !reachable ? 'unknown (laptop unreachable)' : !band ? 'no word from the band yet'
    : band.connected ? `connected · ${band.transport}${band.battery_pct !== null ? ` · ${band.battery_pct}%` : ''}` : 'not connected';
  const micValue = !reachable || !band ? 'unknown' : band.mic_on ? 'on, listening' : 'off';
  const last = state.session?.endedAt ? state.session : null;
  const ready = !!last && state.debrief?.session_id === last.id;
  return (
    <View>
      <T v="serif" size={60} color={idle === 'listening' ? C.paper : C.paper2}>{HEADLINE[idle]}</T>
      <T v="small" style={{ marginTop: 8 }}>{EXPLAIN[idle]}</T>
      <View style={{ marginTop: 18 }}>
        <Line label="Laptop" value={isDemo ? 'demo feed' : listen === 'offline' ? 'unreachable, retrying' : listen === 'connecting' ? 'connecting…' : 'connected'} ok={listen === 'connecting' ? null : listen !== 'offline'} />
        <Line label="Band" value={bandValue} ok={!reachable || !band ? null : band.connected} />
        <Line label="Mic" value={micValue} ok={!reachable || !band ? null : band.mic_on} />
      </View>
      {last ? (
        <Pressable onPress={onOpenDebrief} disabled={!ready} accessibilityRole="link" accessibilityLabel={ready ? 'Read the debrief of the last conversation' : 'The last conversation, debrief being written'}
          style={({ pressed }) => ({ marginTop: 18, borderLeftWidth: 2, borderLeftColor: C.paper, paddingLeft: 12, opacity: pressed ? 0.55 : 1 })}>
          <T v="caps">Last conversation · {clock(((last.endedAt ?? last.startedAt) - last.startedAt) / 1000)}</T>
          <T v="body" style={{ marginTop: 2, fontFamily: F.sansMedium, textDecorationLine: ready ? 'underline' : 'none' }}>
            {ready ? 'Read the debrief' : 'The debrief is being written…'}
          </T>
        </Pressable>
      ) : null}
    </View>
  );
}
