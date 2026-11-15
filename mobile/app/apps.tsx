import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { approveApp, listApps, revokeApp, type AppInfo } from '@/api/client';
import { useLoad } from '@/api/use-load';
import { useBus } from '@/bus/use-bus';
import { Header } from '@/ui/Header';
import { Appear, Avatar, Button, Card, EmptyState, Row, Screen, Section, T, when } from '@/ui/kit';
import { Failed, Fetching, NotPaired } from '@/ui/States';
import { C, S } from '@/ui/theme';

const REFRESH_MS = 4000;
const ACT_FAILED = 'That didn’t go through. Try again.';

interface Waiting { app_id: string; name: string; origin: string | null }

/** "https://app.example.com:443/x" -> "app.example.com". */
function hostOf(origin: string | null): string | null {
  if (!origin) return null;
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i.exec(origin.trim());
  return m ? m[1] : origin.trim() || null;
}

const toIso = (seconds: number | null) => (seconds ? new Date(seconds * 1000).toISOString() : null);

function lastBuzzed(a: AppInfo): string {
  const at = when(toIso(a.last_used));
  return at ? `Last buzzed ${at}` : 'Hasn’t buzzed yet';
}

function WaitingRow({ app, busy, onAllow, onDeny }: { app: Waiting; busy: boolean; onAllow: () => void; onDeny: () => void }) {
  const host = hostOf(app.origin);
  return (
    <View style={styles.waiting}>
      <View style={styles.who}>
        <Avatar name={app.name} id={app.app_id} />
        <View style={styles.whoText}>
          <T v="body" strong numberOfLines={2}>{app.name}</T>
          {host ? <T v="small" numberOfLines={1} style={styles.detail}>{host}</T> : null}
        </View>
      </View>
      <View style={styles.actions}>
        <Button kind="primary" label="Allow" disabled={busy} onPress={onAllow} accessibilityLabel={`Allow ${app.name}`} />
        <Button label="Deny" disabled={busy} onPress={onDeny} accessibilityLabel={`Deny ${app.name}`} />
      </View>
    </View>
  );
}

export default function ConnectedApps() {
  const { state, resolveApp, mode } = useBus();
  const [tick, setTick] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [result, retry] = useLoad(listApps, `${mode}|${state.resync}|${state.appRequests.length}|${tick}`);

  useEffect(() => {
    if (mode !== 'live') return;
    const id = setInterval(() => setTick((n) => n + 1), REFRESH_MS);
    return () => clearInterval(id);
  }, [mode]);

  async function act(fn: (id: string) => Promise<void>, id: string) {
    setBusyId(id); setActError(null);
    try { await fn(id); resolveApp(id); setTick((n) => n + 1); } catch { setActError(ACT_FAILED); } finally { setBusyId(null); }
  }

  const head = <Header title="Connected apps" />;
  if (mode === 'unpaired' || result?.kind === 'not-paired') return <Screen>{head}<NotPaired /></Screen>;
  if (mode === 'loading' || !result) return <Screen>{head}<Fetching /></Screen>;
  if (result.kind === 'error') return <Screen>{head}<Failed unreachable={result.unreachable} onRetry={retry} /></Screen>;

  const apps = result.kind === 'ok' ? result.data : [];
  const known = new Set(apps.map((a) => a.app_id));
  const waiting: Waiting[] = [
    ...apps.filter((a) => a.status === 'pending'),
    ...state.appRequests.filter((r) => !known.has(r.app_id)).map((r) => ({ ...r, origin: null })),
  ];
  const allowed = apps.filter((a) => a.status === 'approved');

  return (
    <Screen>
      {head}
      {actError ? <T v="body" color={C.warn} accessibilityLiveRegion="polite">{actError}</T> : null}

      {waiting.length === 0 && allowed.length === 0 ? (
        <EmptyState icon="apps" title="No connected apps" line="Apps you allow can buzz your band." />
      ) : null}

      {waiting.length ? (
        <Section style={styles.first}>
          <T v="caption" strong color={C.warm} accessibilityRole="header" style={styles.waitLabel}>Waiting for you</T>
          <Appear index={0}>
          <Card list tint={C.warmSoft}>
          {waiting.map((a) => (
            <WaitingRow key={a.app_id} app={a} busy={busyId === a.app_id}
              onAllow={() => void act(approveApp, a.app_id)} onDeny={() => void act(revokeApp, a.app_id)} />
          ))}
          </Card>
          </Appear>
        </Section>
      ) : null}

      {allowed.length ? (
        <Section label="Allowed" style={waiting.length ? undefined : styles.first}>
          <Appear index={1}>
          <Card list>
          {allowed.map((a) => (
            <Row key={a.app_id} title={a.name} detail={lastBuzzed(a)} leading={<Avatar name={a.name} id={a.app_id} />}
              right={<Button kind="danger" label="Remove" disabled={busyId === a.app_id}
                accessibilityLabel={`Remove ${a.name}`} onPress={() => void act(revokeApp, a.app_id)} />} />
          ))}
          </Card>
          </Appear>
        </Section>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  first: { marginTop: S[6] },
  waiting: { paddingVertical: S[4] },
  waitLabel: { marginBottom: S[3] },
  who: { flexDirection: 'row', alignItems: 'center', gap: S[3] },
  whoText: { flex: 1 },
  detail: { marginTop: S[1] },
  actions: { flexDirection: 'row', gap: S[3], marginTop: S[4] },
});
