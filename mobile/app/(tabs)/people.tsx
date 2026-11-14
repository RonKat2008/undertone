import { View } from 'react-native';
import { listPeople } from '@/api/client';
import { okData, useLoad } from '@/api/use-load';
import { useBus, useListVersion } from '@/bus/use-bus';
import { Screen, T } from '@/ui/kit';
import { Failed, Fetching, Notice, NotPaired } from '@/ui/States';
import { C } from '@/ui/theme';

export default function PeopleScreen() {
  const { mode } = useBus();
  const version = useListVersion();
  const [load, retry] = useLoad(listPeople, version);
  const people = okData(load);
  if (mode === 'unpaired') return <Screen title="People"><NotPaired /></Screen>;
  return (
    <Screen title="People">
      <T v="small" style={{ marginBottom: 6 }}>How you talk with each person, against how you talk with everyone else you have tagged. Never against other people’s numbers.</T>
      {!load ? <Fetching what="Fetching the people you have tagged…" style={{ marginTop: 16 }} /> : null}
      {load?.kind === 'error' ? <Failed message={load.message} unreachable={load.unreachable} onRetry={retry} style={{ marginTop: 16 }} /> : null}
      {(people ?? []).map((p) => (
        <View key={p.person_id} style={{ borderTopWidth: 1, borderTopColor: C.paper, paddingTop: 12, marginTop: 18 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
            <T v="serif" size={44}>{p.name}</T>
            <T v="caps">{p.sessions} conversation{p.sessions === 1 ? '' : 's'}</T>
          </View>
          {p.pattern ? (
            <>
              <T v="caps" style={{ marginTop: 10 }}>Your pattern</T>
              <T v="body" style={{ marginTop: 3 }}>{p.pattern}</T>
            </>
          ) : null}
          {p.brief ? (
            <View style={{ backgroundColor: C.well, padding: 14, marginTop: 12 }}>
              <T v="caps" color={C.paper}>Next time</T>
              <T v="serif" size={23} style={{ marginTop: 4 }}>{p.brief}</T>
            </View>
          ) : null}
        </View>
      ))}
      {people && people.length === 0 ? <Notice title="No people yet." body="Tag who a conversation was with at the end of its debrief, and they appear here." style={{ marginTop: 16 }} /> : null}
    </Screen>
  );
}
