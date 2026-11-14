import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { HapticPattern } from '@/bus/contracts';
import { PATTERNS, PATTERN_ORDER } from '@/bus/patterns';
import { play } from '@/haptics/player';
import { Glyph } from '@/ui/Glyph';
import { Header } from '@/ui/Header';
import { Label, Screen, T } from '@/ui/kit';
import { C, S, TONE } from '@/ui/theme';

const GROUPS: { key: 'nudge' | 'status' | 'system'; title: string; note: string }[] = [
  { key: 'nudge', title: 'Nudges', note: 'In a real conversation only “slow down” ever fires. The rest are for practice drills.' },
  { key: 'status', title: 'How am I doing?', note: 'Tap the band once. The answer is a count: slow, even, easy to tell apart.' },
  { key: 'system', title: 'System', note: '' },
];

/** The key element: the glyph playing. A tap plays the glyph and calls play() at the same instant. */
export default function PatternTester() {
  const [last, setLast] = useState<{ pattern: HapticPattern; n: number } | null>(null);
  const fire = (pattern: HapticPattern) => { setLast((l) => ({ pattern, n: (l?.n ?? 0) + 1 })); play(pattern); };
  return (
    <Screen>
      <Header title="Pattern tester" />
      <T v="small">Tap a row to feel it. Each pulse is a note: further right is later, higher is harder, a long bar is a long buzz.</T>
      {GROUPS.map((g) => (
        <View key={g.key} style={{ marginTop: S[7] }}>
          <Label color={C.fg}>{g.title}</Label>
          {g.note ? <T v="small" style={{ marginTop: S[1], marginBottom: S[2] }}>{g.note}</T> : null}
          {PATTERN_ORDER.filter((p) => PATTERNS[p].group === g.key).map((p) => {
            const s = PATTERNS[p];
            const tone = TONE[s.tone];
            const active = last?.pattern === p;
            return (
              <Pressable key={p} onPress={() => fire(p)} accessibilityRole="button" accessibilityLabel={`${s.name}. ${s.feel}. Means: ${s.action}`}
                style={({ pressed }) => ({ borderTopWidth: 1, borderTopColor: C.rule, paddingVertical: S[4], marginHorizontal: -20, paddingHorizontal: 20, backgroundColor: pressed ? tone.tint : 'transparent' })}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
                  <Glyph pattern={p} size={64} playKey={active ? last.n : null} maxWidth={250} />
                  <T v="numS" color={C.fg3} style={{ marginBottom: 4 }}>{p}</T>
                </View>
                <T v="displayS" style={{ marginTop: S[2] }}>{s.action}</T>
                <T v="body" color={C.fg2}>{s.feel}</T>
              </Pressable>
            );
          })}
        </View>
      ))}
    </Screen>
  );
}
