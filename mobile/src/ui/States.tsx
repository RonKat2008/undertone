/** Plain states for when there is nothing real to show: not paired, nothing yet, laptop unreachable. */
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { Btn, T } from './kit';
import { C } from './theme';

interface NoticeProps { title: string; body: string; children?: ReactNode; style?: StyleProp<ViewStyle> }

/** A short serif line and a sentence under it. The transcript screen's notice, shared. */
export function Notice({ title, body, children, style }: NoticeProps) {
  return (
    <View style={style}>
      <T v="serif" size={28}>{title}</T>
      <T v="small" style={{ marginTop: 6 }}>{body}</T>
      {children}
    </View>
  );
}

/** While a read is in flight. */
export function Fetching({ what, style }: { what: string; style?: TextStyle }) {
  return <T v="serif" size={28} color={C.paper3} style={style}>{what}</T>;
}

/** No laptop paired: nothing to show, and the way to fix it. */
export function NotPaired({ style }: { style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  return (
    <Notice title="Not paired yet." body="Pair with your laptop to see your conversations." style={style}>
      <Btn small label="Pair with your laptop" onPress={() => router.push('/pair')} style={{ marginTop: 16, alignSelf: 'flex-start' }} />
    </Notice>
  );
}

/** The laptop could not be reached, or sent something this app cannot read. Never fake rows. */
export function Failed({ message, unreachable = true, onRetry, style }: { message: string; unreachable?: boolean; onRetry: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Notice title={unreachable ? 'Laptop unreachable' : 'Could not load this'}
      body={unreachable ? `${message} Check the laptop is awake and on this Wi-Fi.` : message} style={style}>
      <Btn small label="Try again" onPress={onRetry} style={{ marginTop: 16, alignSelf: 'flex-start' }} />
    </Notice>
  );
}
