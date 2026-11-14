import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { getWeeklyReport, listPeople, listSessions, type Sampled, type SessionListItem } from '@/api/client';
import type { Debrief, Person, SessionSummary, WeeklyReport } from '@/bus/contracts';
import { useListVersion } from '@/bus/use-bus';
import { Rule, SampleTag, Screen, StateMark, T, clock } from '@/ui/kit';
import { C, S } from '@/ui/theme';

type Metric = keyof Debrief['numbers'];

/** Direction words, never colour (§2.4): old in ink-3, new in ink, joined by an arrow. */
const METRIC: Record<Metric, { label: string; short: string; fmt: (v: number) => string; up: string; down: string }> = {
  talk_ratio: { label: 'Talk ratio', short: 'talked', fmt: (v) => `${Math.round(v * 100)}%`, up: 'more', down: 'less' },
  interruptions: { label: 'Interruptions', short: 'interruptions', fmt: (v) => String(Math.round(v)), up: 'more', down: 'fewer' },
  questions: { label: 'Questions', short: 'questions', fmt: (v) => String(Math.round(v)), up: 'more', down: 'fewer' },
  fillers_per_min: { label: 'Fillers / min', short: 'fillers a minute', fmt: (v) => v.toFixed(1), up: 'more', down: 'fewer' },
  wpm: { label: 'Pace', short: 'wpm', fmt: (v) => String(Math.round(v)), up: 'faster', down: 'slower' },
};

function median(values: number[]): number | null {
  if (!values.length) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function HistoryScreen() {
  const router = useRouter();
  const [sessions, setSessions] = useState<Sampled<SessionListItem[]> | null>(null);
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
  const list = sessions?.data ?? [];
  // "Usual" is the median of your own conversations of the same kind.
  const usual = (metric: Metric, kind: SessionSummary['mode']) => median(list.filter((x) => x.mode === kind).map((x) => x.numbers[metric]));

  return (
    <Screen title="History" right={<SampleTag show={sessions?.sample ?? false} />}>
      {r ? (
        <View>
          <View style={{ flexDirection: 'row', gap: S[3], alignItems: 'center' }}>
            <T v="small">This week, against your own baseline</T><SampleTag show={report?.sample ?? false} />
          </View>
          <T v="displayM" style={{ marginTop: S[3] }}>{r.biggest_improvement}</T>
          <View style={{ marginTop: S[5] }}>
            {r.trend.map((t) => {
              const meta = METRIC[t.metric];
              const change = t.from ? Math.abs(t.to - t.from) / Math.abs(t.from) : Math.abs(t.to - t.from);
              const steady = change < 0.03;
              return (
                <View key={t.metric} style={{ flexDirection: 'row', alignItems: 'baseline', borderTopWidth: 1, borderTopColor: C.rule, paddingVertical: S[3] }}
                  accessibilityLabel={steady ? `${meta.label} steady at ${meta.fmt(t.to)}` : `${meta.label} ${meta.fmt(t.from)} to ${meta.fmt(t.to)}, ${t.to > t.from ? meta.up : meta.down}`}>
                  <T v="body" style={{ flex: 1 }}>{meta.label}</T>
                  {steady ? null : <T v="numM" color={C.fg3}>{meta.fmt(t.from)} → </T>}
                  <T v="numM">{meta.fmt(t.to)}</T>
                  <T v="small" color={C.fg2} style={{ width: 52, marginLeft: S[2] }}>{steady ? 'steady' : t.to > t.from ? meta.up : meta.down}</T>
                </View>
              );
            })}
          </View>
        </View>
      ) : null}

      <Rule style={{ marginTop: S[6] }} />
      {list.map((s) => {
        const d = new Date(s.started_at);
        const who = name(s.person_id);
        const picks: Metric[] = s.mode === 'practice' ? ['fillers_per_min', 'wpm'] : ['talk_ratio', 'wpm'];
        return (
          <View key={s.session_id} style={{ borderBottomWidth: 1, borderBottomColor: C.rule, paddingVertical: S[5] }}>
            <Pressable onPress={() => router.push({ pathname: '/debrief', params: { id: s.session_id } })} accessibilityRole="button"
              style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', columnGap: S[3], rowGap: S[1] }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: S[3] }}>
                  <T v="numS" color={C.fg2}>{`${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`}  <T v="numS" color={C.fg3}>{clock(s.duration_s)}</T></T>
                  {s.audio_url ? <RecMark /> : null}
                </View>
                <T v="small">{s.mode === 'practice' ? 'Practice' : s.coach_name}{who ? `, with ${who}` : ''}</T>
              </View>
              <T v="displayS" style={{ marginTop: S[2] }}>{s.headline_fact}</T>
              <View style={{ flexDirection: 'row', gap: S[6], marginTop: S[3] }}>
                {picks.map((k) => {
                  const ref = usual(k, s.mode);
                  return (
                    <View key={k}>
                      <T v="numM">{METRIC[k].fmt(s.numbers[k])}<T v="small" color={C.fg2}> {METRIC[k].short}</T></T>
                      {ref !== null ? <T v="small" color={C.fg3}>usual {METRIC[k].fmt(ref)}</T> : null}
                    </View>
                  );
                })}
              </View>
            </Pressable>
            <Pressable onPress={() => router.push({ pathname: '/transcript', params: { id: s.session_id, headline: s.headline_fact } })} accessibilityRole="link"
              accessibilityLabel={s.audio_url ? 'What was said: transcript and recording' : 'What was said: transcript'} hitSlop={8}
              style={({ pressed }) => ({ alignSelf: 'flex-start', marginTop: S[3], paddingVertical: S[1], opacity: pressed ? 0.55 : 1 })}>
              <T v="body" style={{ textDecorationLine: 'underline' }}>{s.audio_url ? 'What was said, and listen →' : 'What was said →'}</T>
            </Pressable>
          </View>
        );
      })}
      {sessions && list.length === 0 ? <T v="small" style={{ marginTop: S[4] }}>No conversations yet.</T> : null}
    </Screen>
  );
}

/** A recording of this conversation was kept: a neutral state mark (§2.4), never a pattern hue. */
function RecMark() {
  return (
    <View accessible accessibilityLabel="Recording kept" style={{ flexDirection: 'row', alignItems: 'center', gap: S[1] }}>
      <StateMark kind="on" size={10} color={C.fg2} />
      <T v="label" size={13}>rec</T>
    </View>
  );
}
