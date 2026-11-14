import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Svg, { Ellipse, Line, Path } from 'react-native-svg';
import { chooseMission, getMissionToday, getStreak, listPeople } from '@/api/client';
import { firstError, okData, useLoad } from '@/api/use-load';
import type { DailyMission } from '@/bus/contracts';
import { listenState } from '@/bus/phone-state';
import { isLive } from '@/bus/reducer';
import { useBus, useListVersion } from '@/bus/use-bus';
import { Btn, Label, Link, Rule, Screen, StateMark, T, longDate } from '@/ui/kit';
import { Failed, NotPaired } from '@/ui/States';
import { C, F, S } from '@/ui/theme';

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Labels for the last seven days, ending today. */
function lastSeven(): string[] {
  const today = (new Date().getDay() + 6) % 7; // Monday = 0
  return Array.from({ length: 7 }, (_, i) => DAYS[(today - 6 + i + 14) % 7]);
}

export default function TodayScreen() {
  const { state, mode } = useBus();
  const router = useRouter();
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<DailyMission | null>(null);
  const [chooseError, setChooseError] = useState<string | null>(null);
  const version = useListVersion(); // a session ended, its debrief arrived, or the phone reconnected
  const [mission, retryMission] = useLoad(getMissionToday, version);
  const [streak, retryStreak] = useLoad(getStreak, version);
  const [people, retryPeople] = useLoad(listPeople, version);
  const listening = state.alwaysOn && listenState(state) === 'listening';

  useEffect(() => { setChosen(null); }, [mission]); // a fresh answer from the laptop wins

  const unpaired = mode === 'unpaired';
  const failed = firstError(mission, streak, people);
  const m = chosen ?? okData(mission);
  const s = okData(streak);
  const next = okData(people)?.find((p) => p.brief.trim()) ?? null;
  const retry = () => { retryMission(); retryStreak(); retryPeople(); };
  const pick = (focus_rule_id: string) => {
    setChooseError(null);
    chooseMission(focus_rule_id).then(
      (picked) => { setChosen(picked); setChoosing(false); },
      (e: unknown) => setChooseError(e instanceof Error ? e.message : 'That did not work.'),
    );
  };

  return (
    <Screen>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: S[4], minHeight: 24 }}>
        <T v="small">{longDate(new Date())}</T>
        {isLive(state) ? (
          <Pressable onPress={() => router.replace('/live')} accessibilityRole="link" accessibilityLabel={`${state.alwaysOn ? 'In a conversation' : 'Listening now'}. Open Live.`} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: S[2] }}>
            <StateMark kind="listening" /><T v="small" color={C.fg}>{state.alwaysOn ? 'In a conversation' : 'Listening'}</T>
          </Pressable>
        ) : listening ? (
          // always-on, between conversations: the band mic is on, so the same §2.4 ring, in quieter words
          <Pressable onPress={() => router.replace('/live')} accessibilityRole="link" accessibilityLabel="Listening. Open Live." hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: S[2] }}>
            <StateMark kind="listening" /><T v="small">Listening</T>
          </Pressable>
        ) : null}
      </View>

      {unpaired ? <NotPaired style={{ marginTop: S[6] }} /> : failed ? <Failed message={failed.message} unreachable={failed.unreachable} onRetry={retry} style={{ marginTop: S[6] }} /> : null}

      {unpaired || mission?.kind === 'error' ? null : (<>
      <Label style={{ marginTop: S[6] }}>Today’s mission</Label>
      {m ? (
        <>
          <T v="displayL" style={{ marginTop: S[3] }}>{m.text}</T>

          {/* the plan: a hanging italic, the quote mark in the margin */}
          {m.if_then ? (
            <View style={{ marginTop: S[5], paddingLeft: 2 }} accessibilityLabel={`The plan: ${m.if_then}`}>
              <T v="displayS" italic color={C.fg2} style={{ position: 'absolute', left: -12, top: 0 }}>“</T>
              <T v="displayS" italic>{m.if_then}”</T>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: S[2], marginTop: S[5] }} accessibilityLabel={`${Math.min(m.progress, m.target)} of ${m.target} done`}>
            {Array.from({ length: Math.max(1, Math.min(m.target, 10)) }, (_, i) => (
              <View key={i} style={{ flex: 1, height: 4, backgroundColor: i < m.progress ? C.fg : C.rule }} />
            ))}
            <T v="numM" style={{ marginLeft: S[2] }}>{Math.min(m.progress, m.target)}<T v="numM" color={C.fg3}>/{m.target}</T></T>
          </View>
          <T v="small" style={{ marginTop: S[2] }}>{m.done ? 'Done for today.' : 'Counts from your next conversation.'}</T>

          {m.suggestions.length > 0 ? <Link label={choosing ? 'Keep this one' : 'Pick a different mission'} onPress={() => setChoosing((c) => !c)} style={{ marginTop: S[3] }} /> : null}
          {/* Errors are ink and words, never vermilion: vermilion is `interrupt`. */}
          {chooseError ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: S[2], marginTop: S[1] }} accessibilityLiveRegion="polite">
              <StateMark kind="fault" /><T v="body" style={{ fontFamily: F.sansMedium, flex: 1 }}>{chooseError}</T>
            </View>
          ) : null}
          {choosing ? m.suggestions.map((sug) => (
            <Pressable key={sug.focus_rule_id} accessibilityRole="button"
              onPress={() => pick(sug.focus_rule_id)}
              style={({ pressed }) => ({ borderTopWidth: 1, borderTopColor: C.rule, paddingVertical: S[4], opacity: pressed ? 0.5 : 1 })}>
              <T v="displayS" italic color={C.fg2}>{sug.text}</T>
            </Pressable>
          )) : null}
        </>
      ) : mission?.kind === 'none' ? (
        <>
          <T v="displayM" color={C.fg3} style={{ marginTop: S[3] }}>No mission yet.</T>
          <T v="small" style={{ marginTop: S[2] }}>Today’s mission appears here once the laptop has a conversation or two to go on.</T>
        </>
      ) : <T v="displayM" color={C.fg3} style={{ marginTop: S[3] }}>Finding today’s mission…</T>}
      </>)}

      {unpaired || streak === null || streak.kind === 'error' ? null : (<>
      <Rule style={{ marginTop: S[7] }} />
      <Label style={{ marginTop: S[4] }}>Days practised</Label>
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
      ) : <T v="small" style={{ marginTop: S[3] }}>No practice days yet. Any coached conversation counts toward your streak.</T>}
      </>)}

      {next && !unpaired ? (
        <>
          <Rule style={{ marginTop: S[7] }} />
          <Label style={{ marginTop: S[4] }}>{`Before you talk to ${next.name}`}</Label>
          <T v="displayS" style={{ marginTop: S[3] }}>{next.brief}</T>
          {next.pattern ? <T v="small" style={{ marginTop: S[2] }}>{next.pattern}</T> : null}
        </>
      ) : null}

      {state.debrief && !unpaired ? <Btn label="Read the last debrief" onPress={() => router.push('/debrief')} style={{ marginTop: S[6] }} /> : null}
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
