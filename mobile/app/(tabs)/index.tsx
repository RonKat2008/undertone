import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Ellipse, Line, Path } from 'react-native-svg';
import { chooseMission, getMissionToday, getStreak, listPeople, type Sampled } from '@/api/client';
import type { DailyMission, Person, Streak } from '@/bus/contracts';
import { isLive } from '@/bus/reducer';
import { useBus } from '@/bus/use-bus';
import { Btn, Label, Link, Rule, Screen, StateMark, T, longDate } from '@/ui/kit';
import { C, S } from '@/ui/theme';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Labels for the last seven days, ending today. */
function lastSeven(): string[] {
  const today = (new Date().getDay() + 6) % 7; // Monday = 0
  return Array.from({ length: 7 }, (_, i) => DAYS[(today - 6 + i + 14) % 7]);
}

export default function TodayScreen() {
  const { state, mode } = useBus();
  const router = useRouter();
  const [mission, setMission] = useState<Sampled<DailyMission> | null>(null);
  const [streak, setStreak] = useState<Sampled<Streak> | null>(null);
  const [people, setPeople] = useState<Sampled<Person[]> | null>(null);
  const [choosing, setChoosing] = useState(false);
  const debriefAt = state.debrief?.at;

  useEffect(() => {
    let on = true;
    getMissionToday().then((m) => on && setMission(m));
    getStreak().then((s) => on && setStreak(s));
    listPeople().then((p) => on && setPeople(p));
    return () => { on = false; };
  }, [mode, debriefAt]);

  const m = mission?.data;
  const s = streak?.data;
  const next = people?.data[0];

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: S[4], minHeight: 24 }}>
        <T v="small">{longDate(new Date())}</T>
        {isLive(state) ? (
          <Pressable onPress={() => router.replace('/live')} accessibilityRole="link" accessibilityLabel="Listening now. Open Live." hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: S[2] }}>
            <StateMark kind="listening" /><T v="small" color={C.fg}>Listening</T>
          </Pressable>
        ) : null}
      </View>

      <Label sample={mission?.sample} style={{ marginTop: S[6] }}>Today’s mission</Label>
      {m ? (
        <>
          <T v="displayL" style={{ marginTop: S[3] }}>{m.text}</T>

          {/* the plan: a hanging italic, the quote mark in the margin */}
          <View style={{ marginTop: S[5], paddingLeft: 2 }} accessibilityLabel={`The plan: ${m.if_then}`}>
            <T v="displayS" italic color={C.fg2} style={{ position: 'absolute', left: -12, top: 0 }}>“</T>
            <T v="displayS" italic>{m.if_then}”</T>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S[2], marginTop: S[5] }} accessibilityLabel={`${m.progress} of ${m.target} done`}>
            {Array.from({ length: Math.max(1, Math.min(m.target, 10)) }, (_, i) => (
              <View key={i} style={{ flex: 1, height: 4, backgroundColor: i < m.progress ? C.fg : C.rule }} />
            ))}
            <T v="numM" style={{ marginLeft: S[2] }}>{m.progress}<T v="numM" color={C.fg3}>/{m.target}</T></T>
          </View>
          <T v="small" style={{ marginTop: S[2] }}>{m.done ? 'Done for today.' : 'Counts from your next conversation.'}</T>

          <Link label={choosing ? 'Keep this one' : 'Pick a different mission'} onPress={() => setChoosing((c) => !c)} style={{ marginTop: S[3] }} />
          {choosing ? m.suggestions.map((sug) => (
            <Pressable key={sug.focus_rule_id} accessibilityRole="button"
              onPress={() => { void chooseMission(sug.focus_rule_id).then((next) => { setMission({ data: next, sample: mission?.sample ?? true }); setChoosing(false); }); }}
              style={({ pressed }) => ({ borderTopWidth: 1, borderTopColor: C.rule, paddingVertical: S[4], opacity: pressed ? 0.5 : 1 })}>
              <T v="displayS" italic color={C.fg2}>{sug.text}</T>
            </Pressable>
          )) : null}
        </>
      ) : <T v="displayM" color={C.fg3} style={{ marginTop: S[3] }}>Finding today’s mission…</T>}

      <Rule style={{ marginTop: S[7] }} />
      <Label sample={streak?.sample} style={{ marginTop: S[4] }}>Days practised</Label>
      {s ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: S[3] }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: S[2] }}>
              <T v="numL">{s.days}</T>
              <T v="small">{s.days === 1 ? 'day' : 'days'} in a row</T>
            </View>
            <StreakStave week={s.week} freeze={s.freeze_available} />
          </View>
          {s.freeze_available && s.week.some((d) => !d) ? (
            <T v="small" style={{ marginTop: S[3] }}>One day off is covered by your freeze. The count carries on.</T>
          ) : <T v="small" style={{ marginTop: S[3] }}>Any coached conversation counts. It does not have to go well.</T>}
        </>
      ) : null}

      {next ? (
        <>
          <Rule style={{ marginTop: S[7] }} />
          <Label sample={people?.sample} style={{ marginTop: S[4] }}>{`Before you talk to ${next.name}`}</Label>
          <T v="displayS" style={{ marginTop: S[3] }}>{next.brief}</T>
          <T v="small" style={{ marginTop: S[2] }}>{next.pattern}</T>
        </>
      ) : null}

      {state.debrief ? <Btn label="Read the last debrief" onPress={() => router.push('/debrief')} style={{ marginTop: S[6] }} /> : null}
    </Screen>
  );
}

/**
 * The last seven days as noteheads on a stave (§9 Today): a practised day is a filled head,
 * a day covered by a freeze is an open head tied to the next, today is an open head until it counts.
 * There is no broken-streak state.
 */
function StreakStave({ week, freeze }: { week: boolean[]; freeze: boolean }) {
  const labels = lastSeven();
  const step = 26;
  const W = step * 7;
  const H = 36;
  const y0 = 16;
  const rx = 7;
  const ry = 5;
  const heads = week.map((on, i) => ({ on, i, cx: step * i + step / 2, today: i === 6, covered: !on && freeze && i < 6 }));
  return (
    <View accessibilityLabel={`Last seven days: ${week.filter(Boolean).length} practised`}>
      <Svg width={W} height={H}>
        <Line x1={0} x2={W} y1={y0} y2={y0} stroke={C.ruleStrong} strokeWidth={1} />
        {heads.map((h) => {
          if (!h.on && !h.covered && !h.today) return null;
          const open = !h.on;
          const cy = y0;
          return (
            <Ellipse key={h.i} cx={h.cx} cy={cy} rx={open ? rx - 0.8 : rx} ry={open ? ry - 0.8 : ry} fill={open ? 'none' : C.fg} stroke={open ? C.fg : 'none'} strokeWidth={1.6}
              transform={`rotate(-20 ${h.cx} ${cy})`} />
          );
        })}
        {heads.filter((h) => h.covered).map((h) => (
          <Path key={`t${h.i}`} d={`M ${h.cx + 3} ${y0 + 7} Q ${h.cx + step / 2} ${y0 + 13} ${h.cx + step - 3} ${y0 + 7}`} fill="none" stroke={C.fg} strokeWidth={1.3} strokeLinecap="round" />
        ))}
      </Svg>
      <View style={{ flexDirection: 'row' }}>
        {labels.map((l, i) => (
          <T key={i} v="numS" color={i === 6 ? C.fg : C.fg3} style={{ width: step, textAlign: 'center' }}>{l}</T>
        ))}
      </View>
    </View>
  );
}
