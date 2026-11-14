import { useState } from 'react';
import { Pressable, View } from 'react-native';
import type { HapticPattern } from '@/bus/contracts';
import { PATTERNS, PATTERN_ORDER } from '@/bus/patterns';
import { play } from '@/haptics/player';
import { Glyph } from '@/ui/Glyph';
import { Header } from '@/ui/Header';
import { Screen, T } from '@/ui/kit';
import { C, TAKEOVER, TONE } from '@/ui/theme';

const GROUPS: { key: 'nudge' | 'status' | 'system'; title: string; note: string }[] = [
  { key: 'nudge', title: 'Nudges', note: 'In a real conversation only “slow down” ever fires. The rest are for practice drills.' },
  { key: 'status', title: 'How am I doing?', note: 'Tap the band once. The answer is a count: slow, even, easy to tell apart.' },
  { key: 'system', title: 'System', note: '' },
];

export default function PatternTester() {
  const [last, setLast] = useState<{ pattern: HapticPattern; n: number } | null>(null);
  const fire = (pattern: HapticPattern) => { play(pattern); setLast((l) => ({ pattern, n: (l?.n ?? 0) + 1 })); };
  return (
    <Screen>
      <Header title="Pattern tester" />
      <T v="small">Tap a row to feel it. Width is how long, height is how hard, gaps are the pauses.</T>
      {GROUPS.map((g) => (
        <View key={g.key} style={{ marginTop: 24 }}>
          <T v="caps" color={C.paper}>{g.title}</T>
          {g.note ? <T v="small" style={{ marginTop: 2 }}>{g.note}</T> : null}
          {PATTERN_ORDER.filter((p) => PATTERNS[p].group === g.key).map((p) => {
            const s = PATTERNS[p];
            const active = last?.pattern === p;
            return (
              <Pressable key={p} onPress={() => fire(p)} accessibilityRole="button" accessibilityLabel={`${s.name}. ${s.feel}. Means: ${s.action}`}
                style={({ pressed }) => ({ borderTopWidth: 1, borderTopColor: C.rule, paddingVertical: 16, minHeight: 96, backgroundColor: pressed ? TAKEOVER[s.tone].bg : 'transparent' })}>
                {({ pressed }) => {
                  const fg = pressed ? TAKEOVER[s.tone].fg : C.paper;
                  return (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: pressed ? 8 : 0 }}>
                      <View style={{ width: 132, alignItems: 'flex-start' }}>
                        <Glyph pattern={p} size={34} color={pressed ? fg : TONE[s.tone]} playKey={active ? last.n : null} maxWidth={132} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <T v="serif" size={28} color={fg}>{s.action}</T>
                        <T v="small" color={pressed ? fg : C.paper2}>{s.feel}</T>
                        <T v="mono" size={11} color={pressed ? fg : C.paper3} style={{ marginTop: 2 }}>{p}</T>
                      </View>
                    </View>
                  );
                }}
              </Pressable>
            );
          })}
        </View>
      ))}
    </Screen>
  );
}
