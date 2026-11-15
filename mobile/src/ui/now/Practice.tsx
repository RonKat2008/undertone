/** Practice round on Now: the count of crutch words caught is the big word; the prompt is the coach's. */
import { StyleSheet, View } from 'react-native';
import { wordFromReason } from '@/bus/reducer';
import { useBus } from '@/bus/use-bus';
import { Card, Prose, T } from '../kit';
import { C, S } from '../theme';

export function Practice({ finished }: { finished: boolean }) {
  const { state } = useBus();
  const p = state.practice;
  const prompt = state.coach?.drill?.prompts?.[0] ?? null;
  const caught = state.marks
    .filter((m) => m.kind === 'nudge' && m.pattern === 'filler')
    .map((m) => wordFromReason(m.detail))
    .filter((w): w is string => !!w);
  const recent = Array.from(new Set(caught.slice(-4).reverse()));
  const last = p.previous === null ? 'Your first round sets the number to beat.' : `Last round ${p.previous}.`;
  const label = finished
    ? (p.round > 0 ? `Round ${p.round} finished` : 'Round finished')
    : `Practice${p.round > 0 ? ` · round ${p.round}` : ''}`;
  return (
    <View accessibilityLiveRegion="polite" style={styles.center}>
      <T v="small" strong color={C.accent}>{label}</T>
      <T v="display" num style={styles.count} accessibilityLabel={`${p.count} filler words this round`}>{p.count}</T>
      <T v="body" color={C.muted}>{p.count === 1 ? 'filler word this round' : 'filler words this round'}</T>
      <T v="small" style={[styles.line, styles.text]}>{recent.length ? `${recent.join(', ')}. ${last}` : last}</T>
      {prompt && !finished ? (
        <Card tint={C.warmSoft} style={styles.prompt}>
          <T v="small" strong color={C.warm}>Answer this</T>
          <Prose italic style={styles.promptText}>“{prompt}”</Prose>
        </Card>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center' },
  text: { textAlign: 'center' },
  count: { marginTop: S[1] },
  line: { marginTop: S[2] },
  prompt: { marginTop: S[7], alignSelf: 'stretch' },
  promptText: { marginTop: S[2] },
});
