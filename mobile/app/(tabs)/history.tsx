import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { getWeeklyReport, listPeople, listSessions } from '@/api/client';
import { isNum, type MetricKey, type SessionListItem } from '@/api/parse';
import { firstError, okData, useLoad } from '@/api/use-load';
import { useBus, useListVersion } from '@/bus/use-bus';
import { Rule, Screen, StateMark, T, clock } from '@/ui/kit';
import { Failed, Fetching, Notice, NotPaired } from '@/ui/States';
import { C, S } from '@/ui/theme';

type Metric = MetricKey;

/** Direction words, never colour (§2.4): old in ink-3, new in ink, joined by an arrow. */
const METRIC: Record<Metric, { label: string; short: string; fmt: (v: number) => string; up: string; down: string }> = {
  talk_ratio: { label: 'Talk ratio', short: 'talked', fmt: (v) => `${Math.round(v * 100)}%`, up: 'more', down: 'less' },
  interruptions: { label: 'Interruptions', short: 'interruptions', fmt: (v) => String(Math.round(v)), up: 'more', down: 'fewer' },
  questions: { label: 'Questions', short: 'questions', fmt: (v) => String(Math.round(v)), up: 'more', down: 'fewer' },
  fillers_per_min: { label: 'Fillers / min', short: 'fillers a minute', fmt: (v) => v.toFixed(1), up: 'more', down: 'fewer' },
  wpm: { label: 'Pace', short: 'wpm', fmt: (v) => String(Math.round(v)), up: 'faster', down: 'slower' },
};

/** A possibly-missing number, in that metric's format. */
const fmt = (k: Metric, v: number | null) => (v === null ? '–' : METRIC[k].fmt(v));

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
  const { mode } = useBus();
  const version = useListVersion(); // a session ended, its debrief arrived, or the phone reconnected
  const [sessions, retrySessions] = useLoad(listSessions, version);
  const [report, retryReport] = useLoad(getWeeklyReport, version);
  const [peopleLoad] = useLoad(listPeople, version);

  const people = okData(peopleLoad) ?? [];
  const name = (id: string | null) => people.find((p) => p.person_id === id)?.name ?? null;
  const r = okData(report);
  const rows = okData(sessions);
  const list = rows ?? [];
  const failed = firstError(sessions, report);
  // "Usual" is the median of your own conversations of the same kind.
  const usual = (metric: Metric, kind: SessionListItem['mode']) =>
    median(list.filter((x) => x.mode === kind).map((x) => x.numbers?.[metric] ?? null).filter(isNum));

  if (mode === 'unpaired') return <Screen title="History"><NotPaired /></Screen>;
  return (
    <Screen title="History">
      {failed ? <Failed message={failed.message} unreachable={failed.unreachable} onRetry={() => { retrySessions(); retryReport(); }} style={{ marginBottom: S[6] }} /> : null}
      {r ? (
        <View>
          <T v="small">This week, against your own baseline</T>
          {r.biggest_improvement ? <T v="displayM" style={{ marginTop: S[3] }}>{r.biggest_improvement}</T> : null}
          <View style={{ marginTop: S[5] }}>
            {r.trend.map((t) => {
              const meta = METRIC[t.metric];
              if (!meta) return null;
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
      {!sessions ? <Fetching what="Fetching your conversations…" style={{ marginTop: S[5] }} /> : null}
      {list.map((s) => {
        const d = new Date(s.started_at);
        const day = Number.isNaN(d.getTime()) ? 'Unknown date' : `${SHORT_DAYS[d.getDay()]} ${d.getDate()} ${SHORT_MONTHS[d.getMonth()]}`;
        const coach = s.mode === 'practice' ? 'Practice' : s.coach_name;
        const who = name(s.person_id);
        const picks: Metric[] = s.mode === 'practice' ? ['fillers_per_min', 'wpm'] : ['talk_ratio', 'wpm'];
        const n = s.numbers;
        return (
          <View key={s.session_id} style={{ borderBottomWidth: 1, borderBottomColor: C.rule, paddingVertical: S[5] }}>
            <Pressable onPress={() => router.push({ pathname: '/debrief', params: { id: s.session_id } })} accessibilityRole="button"
              style={({ pressed }) => ({ opacity: pressed ? 0.55 : 1 })}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', columnGap: S[3], rowGap: S[1] }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: S[3] }}>
                  <T v="numS" color={C.fg2}>{day}{s.duration_s === null ? null : <T v="numS" color={C.fg3}>{`  ${clock(s.duration_s)}`}</T>}</T>
                  {s.audio_url ? <RecMark /> : null}
                </View>
                {coach || who ? <T v="small">{[coach, who ? `with ${who}` : ''].filter(Boolean).join(', ')}</T> : null}
              </View>
              <T v="displayS" color={s.headline_fact ? C.fg : C.fg3} style={{ marginTop: S[2] }}>{s.headline_fact ?? 'No debrief for this one.'}</T>
              {n ? (
                <View style={{ flexDirection: 'row', gap: S[6], marginTop: S[3] }}>
                  {picks.map((k) => {
                    const ref = usual(k, s.mode);
                    return (
                      <View key={k}>
                        <T v="numM">{fmt(k, n[k])}<T v="small" color={C.fg2}> {METRIC[k].short}</T></T>
                        {ref !== null ? <T v="small" color={C.fg3}>usual {METRIC[k].fmt(ref)}</T> : null}
                      </View>
                    );
                  })}
                </View>
              ) : null}
            </Pressable>
            <Pressable onPress={() => router.push({ pathname: '/transcript', params: s.headline_fact ? { id: s.session_id, headline: s.headline_fact } : { id: s.session_id } })} accessibilityRole="link"
              accessibilityLabel={s.audio_url ? 'What was said: transcript and recording' : 'What was said: transcript'} hitSlop={8}
              style={({ pressed }) => ({ alignSelf: 'flex-start', marginTop: S[3], paddingVertical: S[1], opacity: pressed ? 0.55 : 1 })}>
              <T v="body" style={{ textDecorationLine: 'underline' }}>{s.audio_url ? 'What was said, and listen →' : 'What was said →'}</T>
            </Pressable>
          </View>
        );
      })}
      {rows && rows.length === 0 ? (
        <Notice title="No conversations yet." body="Each conversation the band hears shows up here once it ends, with its debrief and what was said." style={{ marginTop: S[5] }} />
      ) : null}
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
