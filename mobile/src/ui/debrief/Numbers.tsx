/**
 * The conversation's five numbers as a compact visual list: talk share on a meter (the half mark
 * is an even split), pace with its shape over time, and three counts in their own colours.
 */
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Numbers as Nums } from '@/api/parse';
import type { TimelinePoint } from '@/bus/contracts';
import { Card, T } from '@/ui/kit';
import { C, HUES, S, TOUCH } from '@/ui/theme';
import { Meter, Sparkline } from '@/ui/visuals';

const SPARK_H = 36;
const BAND = 0.25; // the usual-pace band: ±25%
const EVEN = 0.5;

interface Count { label: string; value: string; color: string }

function counts(n: Nums): Count[] {
  const out: Count[] = [];
  if (n.questions !== null) out.push({ label: 'Questions', value: String(Math.round(n.questions)), color: HUES[3] });
  if (n.interruptions !== null) out.push({ label: 'Interruptions', value: String(Math.round(n.interruptions)), color: HUES[0] });
  if (n.fillers_per_min !== null) out.push({ label: 'Fillers', value: `${n.fillers_per_min.toFixed(1)} a minute`, color: HUES[1] });
  return out;
}

export function NumbersList({ numbers, timeline, usualWpm }: { numbers: Nums; timeline: TimelinePoint[]; usualWpm: number | null }) {
  const [w, setW] = useState(0);
  const pace = timeline.filter((p) => p.wpm > 0).map((p) => p.wpm);
  const rest = counts(numbers);
  const share = numbers.talk_ratio;
  const wpm = numbers.wpm;
  if (share === null && wpm === null && rest.length === 0) return null;
  const band: [number, number] | undefined = usualWpm ? [usualWpm * (1 - BAND), usualWpm * (1 + BAND)] : undefined;
  return (
    <Card style={styles.card}>
      {share !== null ? (
        <View style={styles.block} accessible accessibilityLabel={`Your share of talking, ${Math.round(share * 100)}%`}>
          <View style={styles.row}>
            <T v="body" color={C.muted} style={styles.flex}>Your share of talking</T>
            <T v="body" strong num color={C.accent}>{Math.round(share * 100)}%</T>
          </View>
          <Meter value={share} color={C.accent} mark={EVEN} style={styles.meter} />
        </View>
      ) : null}
      {wpm !== null ? (
        <View style={styles.block} accessible accessibilityLabel={`Pace, ${Math.round(wpm)} words a minute`}>
          <View style={styles.row}>
            <T v="body" color={C.muted} style={styles.flex}>Pace</T>
            <T v="body" strong num color={C.accent}>{Math.round(wpm)} words a minute</T>
          </View>
          {pace.length >= 2 ? (
            <View style={styles.spark} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
              {w > 0 ? <Sparkline values={pace} width={w} height={SPARK_H} color={C.accent} band={band} /> : null}
            </View>
          ) : null}
        </View>
      ) : null}
      {rest.map((c) => (
        <View key={c.label} style={styles.row} accessible accessibilityLabel={`${c.label}, ${c.value}`}>
          <T v="body" color={C.muted} style={styles.flex}>{c.label}</T>
          <T v="body" strong num color={c.color}>{c.value}</T>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: S[4] },
  flex: { flex: 1 },
  block: { marginBottom: S[3] },
  row: { flexDirection: 'row', alignItems: 'center', gap: S[4], minHeight: TOUCH },
  meter: { marginTop: S[1] },
  spark: { height: SPARK_H, marginTop: S[1] },
});
