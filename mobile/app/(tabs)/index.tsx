import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { chooseMission, getMissionToday, getStreak, listPeople } from '@/api/client';
import { firstError, okData, useLoad } from '@/api/use-load';
import type { DailyMission } from '@/bus/contracts';
import { listenState } from '@/bus/phone-state';
import { isLive } from '@/bus/reducer';
import { useBus, useListVersion } from '@/bus/use-bus';
import { Btn, Rule, Screen, T } from '@/ui/kit';
import { Failed, NotPaired } from '@/ui/States';
import { C, TONE } from '@/ui/theme';

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
  const labels = lastSeven();
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
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <T v="caps">{new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</T>
        {isLive(state) ? (
          <Pressable onPress={() => router.replace('/live')} accessibilityRole="link" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: C.mic }} /><T v="caps" color={C.paper}>{state.alwaysOn ? 'In a conversation' : 'Listening now'}</T>
          </Pressable>
        ) : listening ? (
          <Pressable onPress={() => router.replace('/live')} accessibilityRole="link" style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, borderWidth: 1, borderColor: C.mic }} /><T v="caps">Listening</T>
          </Pressable>
        ) : null}
      </View>

      {unpaired ? <NotPaired style={{ marginTop: 22 }} /> : failed ? <Failed message={failed.message} unreachable={failed.unreachable} onRetry={retry} style={{ marginTop: 22 }} /> : null}

      {unpaired || mission?.kind === 'error' ? null : (<>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22 }}>
        <T v="caps" color={C.paper}>Today’s mission</T>
      </View>
      {m ? (
        <>
          <T v="serif" size={40} style={{ marginTop: 8 }}>{m.text}</T>
          {m.if_then ? (
            <View style={{ borderLeftWidth: 2, borderLeftColor: C.paper, paddingLeft: 14, marginTop: 16 }}>
              <T v="caps">The plan</T>
              <T v="serif" size={24} style={{ fontFamily: 'InstrumentSerif_400Regular_Italic', marginTop: 2 }}>{m.if_then}</T>
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 20 }} accessibilityLabel={`${Math.min(m.progress, m.target)} of ${m.target} done`}>
            {Array.from({ length: Math.max(1, Math.min(m.target, 10)) }, (_, i) => (
              <View key={i} style={{ flex: 1, height: 10, borderWidth: 1, borderColor: C.paper, backgroundColor: i < m.progress ? C.paper : 'transparent' }} />
            ))}
            <T v="mono" size={20} style={{ marginLeft: 6 }}>{Math.min(m.progress, m.target)}/{m.target}</T>
          </View>
          <T v="small" style={{ marginTop: 6 }}>{m.done ? 'Done for today.' : 'Counts from your next conversation.'}</T>

          {m.suggestions.length > 0 ? (
            <Pressable onPress={() => setChoosing((c) => !c)} accessibilityRole="button" style={{ marginTop: 16, paddingVertical: 8 }}>
              <T v="caps" color={C.paper} style={{ textDecorationLine: 'underline' }}>{choosing ? 'Keep this one' : 'Pick a different mission'}</T>
            </Pressable>
          ) : null}
          {chooseError ? <T v="small" color={TONE.vermilion} style={{ marginTop: 4 }}>{chooseError}</T> : null}
          {choosing ? m.suggestions.map((sug) => (
            <Pressable key={sug.focus_rule_id} accessibilityRole="button"
              onPress={() => pick(sug.focus_rule_id)}
              style={({ pressed }) => ({ borderTopWidth: 1, borderTopColor: C.rule, paddingVertical: 14, opacity: pressed ? 0.5 : 1 })}>
              <T v="serif" size={22}>{sug.text}</T>
            </Pressable>
          )) : null}
        </>
      ) : mission?.kind === 'none' ? (
        <>
          <T v="serif" size={30} color={C.paper3} style={{ marginTop: 8 }}>No mission yet.</T>
          <T v="small" style={{ marginTop: 6 }}>Today’s mission appears here once the laptop has a conversation or two to go on.</T>
        </>
      ) : <T v="serif" size={30} color={C.paper3} style={{ marginTop: 8 }}>Finding today’s mission…</T>}
      </>)}

      {unpaired || streak === null || streak.kind === 'error' ? null : (<>
      <Rule strong style={{ marginTop: 26 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
        <T v="caps" color={C.paper}>Days practised</T>
      </View>
      {s ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <T v="mono" size={64} style={{ lineHeight: 62 }}>{s.days}</T>
              <T v="small" style={{ marginBottom: 8 }}>{s.days === 1 ? 'day' : 'days'} in a row</T>
            </View>
            <View style={{ flexDirection: 'row', gap: 7 }}>
              {s.week.map((on, i) => (
                <View key={i} style={{ alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 22, height: 34, borderWidth: 1, borderColor: on ? C.paper : C.paper3, borderStyle: on ? 'solid' : 'dashed', backgroundColor: on ? C.paper : 'transparent' }} />
                  <T v="caps" size={9.5}>{labels[i]}</T>
                </View>
              ))}
            </View>
          </View>
          {s.freeze_available && s.week.some((d) => !d) ? (
            <T v="small" style={{ marginTop: 10 }}>One day off is covered by your freeze. The count carries on.</T>
          ) : <T v="small" style={{ marginTop: 10 }}>Any coached conversation counts. It does not have to go well.</T>}
        </>
      ) : <T v="small" style={{ marginTop: 8 }}>No practice days yet. Any coached conversation counts toward your streak.</T>}
      </>)}

      {next && !unpaired ? (
        <>
          <Rule strong style={{ marginTop: 26 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <T v="caps" color={C.paper}>Before you talk to {next.name}</T>
          </View>
          <T v="serif" size={28} style={{ marginTop: 8 }}>{next.brief}</T>
          {next.pattern ? <T v="small" style={{ marginTop: 8 }}>{next.pattern}</T> : null}
        </>
      ) : null}

      {state.debrief && !unpaired ? <Btn label="Read the last debrief" onPress={() => router.push('/debrief')} style={{ marginTop: 26 }} color={TONE.ink} /> : null}
    </Screen>
  );
}
