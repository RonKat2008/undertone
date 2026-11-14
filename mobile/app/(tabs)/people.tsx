import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { listPeople, type Sampled } from '@/api/client';
import type { Person } from '@/bus/contracts';
import { useBus } from '@/bus/use-bus';
import { Label, SampleTag, Screen, T } from '@/ui/kit';
import { C, S } from '@/ui/theme';

export default function PeopleScreen() {
  const { mode } = useBus();
  const [people, setPeople] = useState<Sampled<Person[]> | null>(null);
  useEffect(() => {
    let on = true;
    listPeople().then((p) => on && setPeople(p));
    return () => { on = false; };
  }, [mode]);
  return (
    <Screen title="People" right={<SampleTag show={people?.sample ?? false} />}>
      <T v="small">How you talk with each person, against how you talk with everyone else you have tagged. Never against other people’s numbers.</T>
      {(people?.data ?? []).map((p) => (
        <View key={p.person_id} style={{ borderTopWidth: 1, borderTopColor: C.rule, paddingTop: S[4], marginTop: S[6] }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <T v="displayL">{p.name}</T>
            <T v="numS" color={C.fg3}>{p.sessions} <T v="small" color={C.fg3}>conversation{p.sessions === 1 ? '' : 's'}</T></T>
          </View>
          <T v="body" style={{ marginTop: S[3] }}>{p.pattern}</T>
          <Label style={{ marginTop: S[5] }}>Next time</Label>
          {/* a hanging italic: the quote mark sits in the margin */}
          <View style={{ marginTop: S[1] }}>
            <T v="displayS" italic color={C.fg2} style={{ position: 'absolute', left: -12, top: 0 }}>“</T>
            <T v="displayS" italic>{p.brief}”</T>
          </View>
        </View>
      ))}
      {people && people.data.length === 0 ? <T v="small" style={{ marginTop: S[4] }}>Tag who a conversation was with at the end of its debrief.</T> : null}
    </Screen>
  );
}
