/** Conversations: every conversation with its debrief headline, grouped by day, or the people you talk with. */
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getWeeklyReport, listPeople, listRelationships, listSessions, type Load, type RelationshipKind } from '@/api/client';
import { firstError, okData, useLoad } from '@/api/use-load';
import { useBus, useListVersion } from '@/bus/use-bus';
import { Ambient, Appear, Card, EmptyState, Section, Segmented, Title } from '@/ui/kit';
import { Failed, Fetching, NotPaired } from '@/ui/States';
import { PeopleList } from '@/ui/conversations/PeopleList';
import { SessionRow } from '@/ui/conversations/SessionRow';
import { WeekLine } from '@/ui/conversations/WeekLine';
import { groupByDay } from '@/ui/conversations/words';
import { C, GUTTER, S } from '@/ui/theme';

type Tab = 'all' | 'people';
const TABS: { key: Tab; label: string }[] = [{ key: 'all', label: 'All' }, { key: 'people', label: 'People' }];
const GLOW = 0.16; // same as kit's Screen

/** A list read that the laptop answered with "nothing yet" is an empty list. */
function listOf<T>(l: Load<T[]> | null): T[] | null {
  if (!l) return null;
  if (l.kind === 'none') return [];
  return okData(l);
}

export default function ConversationsScreen() {
  const router = useRouter();
  const { mode, state } = useBus();
  const version = useListVersion();
  const [tab, setTab] = useState<Tab>('all');
  const [sessionsLoad, retrySessions] = useLoad(listSessions, version);
  const [peopleLoad, retryPeople] = useLoad(listPeople, version);
  const [reportLoad, retryReport] = useLoad(getWeeklyReport, version);
  const [relationsLoad, retryRelations] = useLoad(listRelationships, version);

  const sessions = listOf(sessionsLoad);
  const people = listOf(peopleLoad);
  const report = okData(reportLoad);
  const kinds = new Map<string, RelationshipKind>((okData(relationsLoad) ?? []).map((r) => [r.person_id, r.kind]));
  const names = new Map((people ?? []).map((p) => [p.person_id, p.name]));
  const unreadId = state.notice?.session_id ?? null;
  const failed = firstError(sessionsLoad, peopleLoad);
  const notPaired = mode === 'unpaired' || sessionsLoad?.kind === 'not-paired' || peopleLoad?.kind === 'not-paired';

  const retry = () => { retrySessions(); retryPeople(); retryReport(); retryRelations(); };
  const open = (id: string) => router.push({ pathname: '/debrief', params: { id } });

  const allTab = () => {
    if (!sessions) return <Fetching what="Loading your conversations" />;
    if (!sessions.length) return <EmptyState icon="talk" title="No conversations yet" line="They appear here after the band hears one." />;
    let index = 0;
    return (
      <>
        {report ? <Appear><WeekLine report={report} /></Appear> : null}
        {groupByDay(sessions).map((g, gi) => (
          <Section key={g.label} label={g.label} style={gi === 0 ? styles.firstSection : undefined}>
            <Card list>
              {g.items.map((s) => (
                <Appear key={s.session_id} index={index++}>
                  <SessionRow session={s} personName={s.person_id ? names.get(s.person_id) : null}
                    unread={s.session_id === unreadId} onOpen={open} />
                </Appear>
              ))}
            </Card>
          </Section>
        ))}
      </>
    );
  };

  const peopleTab = () => {
    if (!people || !sessions) return <Fetching what="Loading the people you talk with" />;
    if (!people.length) return <EmptyState icon="people" title="No people yet" line="Tag who you talked with from a debrief." />;
    return <PeopleList people={people} sessions={sessions} kinds={kinds} unreadId={unreadId} onOpen={open} />;
  };

  const body = () => {
    if (notPaired) return <NotPaired />;
    if (failed) return <Failed unreachable={failed.unreachable} onRetry={retry} />;
    return tab === 'all' ? allTab() : peopleTab();
  };

  return (
    <View style={styles.page}>
      <Ambient color={C.accent} strength={GLOW} />
      <SafeAreaView style={styles.flex} edges={['top', 'left', 'right']}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}
          refreshControl={notPaired ? undefined : <RefreshControl refreshing={false} onRefresh={retry} tintColor={C.muted} />}>
          <Title>Conversations</Title>
          {notPaired ? null : <Segmented options={TABS} value={tab} onChange={setTab} style={styles.segmented} />}
          {body()}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: C.bg },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: GUTTER, paddingBottom: S[8] },
  segmented: { marginBottom: S[5] },
  firstSection: { marginTop: S[5] },
});
