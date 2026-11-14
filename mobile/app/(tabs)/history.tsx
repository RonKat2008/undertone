import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { getWeeklyReport, listPeople, listSessions, type Sampled } from '@/api/client';
import type { Person, SessionSummary, WeeklyReport } from '@/bus/contracts';
import { useListVersion } from '@/bus/use-bus';
import { Rule, SampleTag, Screen, T, clock } from '@/ui/kit';
import { C, TONE } from '@/ui/theme';

const METRIC: Record<string, { label: string; fmt: (v: number) => string; lowerIsBetter: boolean }> = {
  talk_ratio: { label: 'Talk ratio', fmt: (v) => `${Math.round(v * 100)}%`, lowerIsBetter: true },
  interruptions: { label: 'Interruptions', fmt: (v) => String(Math.round(v)), lowerIsBetter: true },
  questions: { label: 'Questions', fmt: (v) => String(Math.round(v)), lowerIsBetter: false },
  fillers_per_min: { label: 'Fillers / min', fmt: (v) => v.toFixed(1), lowerIsBetter: true },
  wpm: { label: 'Pace', fmt: (v) => String(Math.round(v)), lowerIsBetter: true },
};

export default function HistoryScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Sampled<SessionSummary[]> | null>(null);
  const [report, setReport] = useState<Sampled<WeeklyReport> | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const version = useListVersion(); // a session ended, its debrief arrived, or the phone reconnected

  useEffect(() => {
    let on = true;
    listSessions().then((s) => on && setSessions(s));
    getWeeklyReport().then((r) => on && setReport(r));
    listPeople().then((p) => on && setPeople(p.data));
    return () => { on = false; };
  }, [version]);

  const name = (id: string | null) => people.find((p) => p.person_id === id)?.name ?? null;
  const r = report?.data;

  return (
    <Screen title="History" right={<SampleTag show={sessions?.sample ?? false} />}>
      {r ? (
        <View style={{ marginBottom: 22 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><T v="caps" color={C.paper}>This week, against your own baseline</T><SampleTag show={report?.sample ?? false} /></View>
          <T v="serif" size={26} style={{ marginTop: 8 }}>{r.biggest_improvement}</T>
          <View style={{ marginTop: 12 }}>
            {r.trend.map((t) => {
              const meta = METRIC[t.metric];
              const better = meta.lowerIsBetter ? t.to < t.from : t.to > t.from;
              const same = t.to === t.from;
              return (
                <View key={t.metric} style={{ flexDirection: 'row', alignItems: 'center', borderTopWidth: 1, borderTopColor: C.rule, paddingVertical: 9 }}>
                  <T v="small" color={C.paper} style={{ flex: 1 }}>{meta.label}</T>
                  <T v="mono" size={15} color={C.paper3}>{meta.fmt(t.from)}  →  </T>
                  <T v="mono" size={19} color={same ? C.paper : better ? TONE.green : C.paper}>{meta.fmt(t.to)}</T>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      <Rule strong />
      {(sessions?.data ?? []).map((s) => {
        const d = new Date(s.started_at);
        const who = name(s.person_id);
        return (
          <Pressable key={s.session_id} onPress={() => router.push({ pathname: '/debrief', params: { id: s.session_id } })} accessibilityRole="button"
            style={({ pressed }) => ({ borderBottomWidth: 1, borderBottomColor: C.rule, paddingVertical: 16, opacity: pressed ? 0.55 : 1 })}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <T v="caps">{d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} · {clock(s.duration_s)}</T>
              <T v="caps">{s.mode === 'practice' ? 'practice' : s.coach_name}{who ? ` · with ${who}` : ''}</T>
            </View>
            <T v="serif" size={24} style={{ marginTop: 6 }}>{s.headline_fact}</T>
            <View style={{ flexDirection: 'row', gap: 18, marginTop: 10 }}>
              <Stat v={`${Math.round(s.numbers.talk_ratio * 100)}%`} l="talk" />
              <Stat v={String(s.numbers.interruptions)} l="interr." />
              <Stat v={String(s.numbers.questions)} l="quest." />
              <Stat v={s.numbers.fillers_per_min.toFixed(1)} l="fill/min" />
              <Stat v={String(Math.round(s.numbers.wpm))} l="wpm" />
            </View>
          </Pressable>
        );
      })}
      {sessions && sessions.data.length === 0 ? <T v="small" style={{ marginTop: 16 }}>No conversations yet.</T> : null}
    </Screen>
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return <View><T v="mono" size={18}>{v}</T><T v="caps" size={9.5}>{l}</T></View>;
}
