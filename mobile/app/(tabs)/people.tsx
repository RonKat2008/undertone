import { View } from 'react-native';
import { listPeople } from '@/api/client';
import { okData, useLoad } from '@/api/use-load';
import { useBus, useListVersion } from '@/bus/use-bus';
import { Label, Screen, T } from '@/ui/kit';
import { Failed, Fetching, Notice, NotPaired } from '@/ui/States';
import { C, S } from '@/ui/theme';

export default function PeopleScreen() {
  const { mode } = useBus();
  const version = useListVersion();
  const [load, retry] = useLoad(listPeople, version);
  const people = okData(load);
  if (mode === 'unpaired') return <Screen title="People"><NotPaired /></Screen>;
  return (
    <Screen title="People">
      <T v="small">How you talk with each person, against how you talk with everyone else you have tagged. Never against other people’s numbers.</T>
      {!load ? <Fetching what="Fetching the people you have tagged…" style={{ marginTop: S[5] }} /> : null}
      {load?.kind === 'error' ? <Failed message={load.message} unreachable={load.unreachable} onRetry={retry} style={{ marginTop: S[5] }} /> : null}
      {(people ?? []).map((p) => (
        <View key={p.person_id} style={{ borderTopWidth: 1, borderTopColor: C.rule, paddingTop: S[4], marginTop: S[6] }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <T v="displayL">{p.name}</T>
            <T v="numS" color={C.fg3}>{p.sessions} <T v="small" color={C.fg3}>conversation{p.sessions === 1 ? '' : 's'}</T></T>
          </View>
          {p.pattern ? <T v="body" style={{ marginTop: S[3] }}>{p.pattern}</T> : null}
          {p.brief ? (
            <>
              <Label style={{ marginTop: S[5] }}>Next time</Label>
              {/* a hanging italic: the quote mark sits in the margin */}
              <View style={{ marginTop: S[1] }}>
                <T v="displayS" italic color={C.fg2} style={{ position: 'absolute', left: -12, top: 0 }}>“</T>
                <T v="displayS" italic>{p.brief}”</T>
              </View>
            </>
          ) : null}
        </View>
      ))}
      {people && people.length === 0 ? <Notice title="No people yet." body="Tag who a conversation was with at the end of its debrief, and they appear here." style={{ marginTop: S[5] }} /> : null}
    </Screen>
  );
}
