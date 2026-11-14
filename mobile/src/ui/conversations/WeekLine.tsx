/** The weekly report as a small warm card: one line collapsed, the trends in plain words on a tap. */
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import type { WeeklyReport } from '@/bus/contracts';
import { Card, T } from '@/ui/kit';
import { C, S, TOUCH } from '@/ui/theme';
import { trendWords, type TrendWords } from './words';

const TONE: Record<TrendWords['tone'], string> = { better: C.accent, worse: C.warm, neutral: C.muted };

export function WeekLine({ report }: { report: WeeklyReport }) {
  const [open, setOpen] = useState(false);
  const trends = report.trend.map(trendWords).filter((t): t is TrendWords => !!t);
  const sentence = report.biggest_improvement.trim();
  if (!trends.length && !sentence) return null;
  const summary = sentence || trends[0].line;
  const canOpen = trends.length > 0;

  const content = (
    <>
      <View style={styles.head}>
        <T v="caption" strong color={C.warm} style={styles.flex}>This week</T>
        {canOpen ? <T v="caption" color={C.muted}>{open ? 'Hide' : 'Show'}</T> : null}
      </View>
      <T v="small" color={C.text} numberOfLines={open ? undefined : 1} style={styles.summary}>{summary}</T>
      {open ? (
        <View style={styles.trends}>
          {trends.map((t) => (
            <View key={t.key} style={styles.trend}>
              <T v="small" num style={styles.flex}>{t.line}</T>
              <T v="caption" strong color={TONE[t.tone]}>{t.word}</T>
            </View>
          ))}
        </View>
      ) : null}
    </>
  );

  return (
    <Card tint={C.warmSoft} style={styles.card}>
      {canOpen ? (
        <Pressable onPress={() => setOpen((o) => !o)} accessibilityRole="button" accessibilityState={{ expanded: open }}
          accessibilityLabel={`This week: ${summary}`} style={({ pressed }) => [styles.press, pressed && styles.dim]}>
          {content}
        </Pressable>
      ) : <View style={styles.press}>{content}</View>}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: S[2] },
  press: { minHeight: TOUCH, justifyContent: 'center' },
  dim: { opacity: 0.7 },
  head: { flexDirection: 'row', alignItems: 'center' },
  flex: { flex: 1 },
  summary: { marginTop: S[1] },
  trends: { marginTop: S[3], gap: S[2] },
  trend: { flexDirection: 'row', alignItems: 'baseline', gap: S[3] },
});
