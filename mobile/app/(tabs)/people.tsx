import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { listPeople, type Sampled } from '@/api/client';
import type { Person } from '@/bus/contracts';
import { useListVersion } from '@/bus/use-bus';
import { SampleTag, Screen, T } from '@/ui/kit';
import { C } from '@/ui/theme';

export default function PeopleScreen() {
  const version = useListVersion();
  const [people, setPeople] = useState<Sampled<Person[]> | null>(null);
  useEffect(() => {
    let on = true;
    listPeople().then((p) => on && setPeople(p));
    return () => { on = false; };
  }, [version]);
  return (
    <Screen title="People" right={<SampleTag show={people?.sample ?? false} />}>
      <T v="small" style={{ marginBottom: 6 }}>How you talk with each person, against how you talk with everyone else you have tagged. Never against other people’s numbers.</T>
      {(people?.data ?? []).map((p) => (
        <View key={p.person_id} style={{ borderTopWidth: 1, borderTopColor: C.paper, paddingTop: 12, marginTop: 18 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <T v="serif" size={44}>{p.name}</T>
            <T v="caps">{p.sessions} conversation{p.sessions === 1 ? '' : 's'}</T>
          </View>
          <T v="caps" style={{ marginTop: 10 }}>Your pattern</T>
          <T v="body" style={{ marginTop: 3 }}>{p.pattern}</T>
          <View style={{ backgroundColor: C.well, padding: 14, marginTop: 12 }}>
            <T v="caps" color={C.paper}>Next time</T>
            <T v="serif" size={23} style={{ marginTop: 4 }}>{p.brief}</T>
          </View>
        </View>
      ))}
      {people && people.data.length === 0 ? <T v="small" style={{ marginTop: 16 }}>Tag who a conversation was with at the end of its debrief.</T> : null}
    </Screen>
  );
}
