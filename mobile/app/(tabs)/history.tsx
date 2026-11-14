import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { getWeeklyReport, listPeople, listSessions } from '@/api/client';
import { fmtInt, fmtOne, fmtPct } from '@/api/parse';
import { firstError, okData, useLoad } from '@/api/use-load';
import { useBus, useListVersion } from '@/bus/use-bus';
import { Rule, Screen, T, clock } from '@/ui/kit';
import { Failed, Fetching, Notice, NotPaired } from '@/ui/States';
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
  const { mode } = useBus();
  const version = useListVersion(); // a session ended, its debrief arrived, or the phone reconnected
  const [sessions, retrySessions] = useLoad(listSessions, version);
  const [report, retryReport] = useLoad(getWeeklyReport, version);
  const [peopleLoad] = useLoad(listPeople, version);

  const people = okData(peopleLoad) ?? [];
  const name = (id: string | null) => people.find((p) => p.person_id === id)?.name ?? null;
  const r = okData(report);
  const rows = okData(sessions);
  const failed = firstError(sessions, report);

  if (mode === 'unpaired') return <Screen title="History"><NotPaired /></Screen>;
  return (
    <Screen title="History">
      {failed ? <Failed message={failed.message} unreachable={failed.unreachable} onRetry={() => { retrySessions(); retryReport(); }} style={{ marginBottom: 22 }} /> : null}
      {r ? (
        <View style={{ marginBottom: 22 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}><T v="caps" color={C.paper}>This week, against your own baseline</T></View>
          {r.biggest_improvement ? <T v="serif" size={26} style={{ marginTop: 8 }}>{r.biggest_improvement}</T> : null}
          <View style={{ marginTop: 12 }}>
            {r.trend.map((t) => {
              const meta = METRIC[t.metric];
              if (!meta) return null;
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
      {!sessions ? <Fetching what="Fetching your conversations…" style={{ marginTop: 16 }} /> : null}
      {(rows ?? []).map((s) => {
        const d = new Date(s.started_at);
        const day = Number.isNaN(d.getTime()) ? 'Unknown date' : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
        const when = s.duration_s === null ? day : `${day} · ${clock(s.duration_s)}`;
        const coach = s.mode === 'practice' ? 'practice' : s.coach_name;
        const who = name(s.person_id);
        const n = s.numbers;
        return (
          <View key={s.session_id} style={{ borderBottomWidth: 1, borderBottomColor: C.rule, paddingVertical: 16 }}>
            <Pressable onPress={() => router.push({ pathname: '/debrief', params: { id: s.session_id } })} accessibilityRole="button"
              style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', columnGap: 10, rowGap: 4 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <T v="caps">{when}</T>
                  {s.audio_url ? <RecMark /> : null}
                </View>
                {coach || who ? <T v="caps">{[coach, who ? `with ${who}` : ''].filter(Boolean).join(' · ')}</T> : null}
              </View>
              <T v="serif" size={24} style={{ marginTop: 6 }} color={s.headline_fact ? undefined : C.paper3}>{s.headline_fact ?? 'No debrief for this one.'}</T>
              {n ? (
                <View style={{ flexDirection: 'row', gap: 18, marginTop: 10 }}>
                  <Stat v={fmtPct(n.talk_ratio)} l="talk" />
                  <Stat v={fmtInt(n.interruptions)} l="interr." />
                  <Stat v={fmtInt(n.questions)} l="quest." />
                  <Stat v={fmtOne(n.fillers_per_min)} l="fill/min" />
                  <Stat v={fmtInt(n.wpm)} l="wpm" />
                </View>
              ) : null}
            </Pressable>
            <Pressable onPress={() => router.push({ pathname: '/transcript', params: s.headline_fact ? { id: s.session_id, headline: s.headline_fact } : { id: s.session_id } })} accessibilityRole="button"
              accessibilityLabel={s.audio_url ? 'What was said: transcript and recording' : 'What was said: transcript'} hitSlop={8}
              style={({ pressed }) => ({ alignSelf: 'flex-start', marginTop: 10, paddingVertical: 6, opacity: pressed ? 0.5 : 1 })}>
              <T v="caps" color={C.paper}>{s.audio_url ? 'What was said · listen  →' : 'What was said  →'}</T>
            </Pressable>
          </View>
        );
      })}
      {rows && rows.length === 0 ? (
        <Notice title="No conversations yet." body="Each conversation the band hears shows up here once it ends, with its debrief and what was said." style={{ marginTop: 16 }} />
      ) : null}
    </Screen>
  );
}

/** A recording of this conversation was kept. */
function RecMark() {
  return (
    <View accessible accessibilityLabel="Recording kept" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderColor: C.paper3, borderRadius: 2, paddingHorizontal: 5, paddingVertical: 1 }}>
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: TONE.vermilion }} />
      <T v="caps" size={9.5}>rec</T>
    </View>
  );
}

function Stat({ v, l }: { v: string; l: string }) {
  return <View><T v="mono" size={18}>{v}</T><T v="caps" size={9.5}>{l}</T></View>;
}
