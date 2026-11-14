/** Honest states for when there is nothing real to show: not paired, loading, laptop unreachable. */
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Button, EmptyState, T } from './kit';
import { C, S } from './theme';

/** A title-sized sentence and a line. Kept for screens that say why something is missing. */
export function Notice({ title, body, children, style }: { title: string; body: string; children?: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <EmptyState title={title} line={body} action={children} style={style} />;
}

/** While a read is in flight: one quiet line, no spinner theatre. */
export function Fetching({ what = 'Loading', style }: { what?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.fetching, style]} accessibilityLiveRegion="polite">
      <T v="small" color={C.muted}>{what}</T>
    </View>
  );
}

/** No laptop paired: nothing to show, and the way to fix it. */
export function NotPaired({ style }: { style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  return (
    <EmptyState title="Not paired" line="Pair with your laptop to see this." style={style}
      action={<Button kind="primary" label="Pair" onPress={() => router.push('/pair')} />} />
  );
}

/** The laptop could not be reached, or sent something this app cannot read. Never fake rows. */
export function Failed({ unreachable = true, onRetry, style }: { message?: string; unreachable?: boolean; onRetry: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <EmptyState
      title={unreachable ? 'Can’t reach your laptop' : 'Something went wrong'}
      line={unreachable ? 'Check it’s awake and on the same Wi-Fi.' : 'The laptop sent something this app can’t read.'}
      style={style}
      action={<Button label="Try again" onPress={onRetry} />} />
  );
}

const styles = StyleSheet.create({
  fetching: { paddingVertical: S[6] },
});
