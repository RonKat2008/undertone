import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { approveApp, listApps, revokeApp, type AppInfo } from '@/api/client';
import { useBus } from '@/bus/use-bus';
import { Glyph } from '@/ui/Glyph';
import { Header } from '@/ui/Header';
import { Btn, Label, SampleTag, Screen, StateMark, T } from '@/ui/kit';
import { C, F, S, TONE } from '@/ui/theme';

function ago(seconds: number | null): string {
  if (!seconds) return 'never';
  const s = Math.max(0, Date.now() / 1000 - seconds);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export default function ConnectedApps() {
  const { state, buzzes, resolveApp, mode } = useBus();
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [sample, setSample] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { const r = await listApps(); setApps(r.data); setSample(r.sample); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Cannot reach the laptop.'); }
  }, []);
  const requests = state.appRequests.length;
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 4000);
    return () => clearInterval(id);
  }, [refresh, requests, mode]);

  const act = async (fn: (id: string) => Promise<void>, id: string) => {
    try { await fn(id); resolveApp(id); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'That did not work.'); }
  };
  const pending = apps.filter((a) => a.status === 'pending');
  const rest = apps.filter((a) => a.status !== 'pending');
  const foreign = buzzes.filter((b) => b.source_app !== 'undertone').slice(0, 8);

  return (
    <Screen>
      <Header title="Connected apps" right={<SampleTag show={sample} />} />
      <T v="small">Any site or app can ask to tap you. Nothing buzzes until you say yes here, and you can take it back.</T>
      {/* Errors are ink and words, never vermilion: vermilion is `interrupt`. */}
      {error ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S[2], marginTop: S[3] }} accessibilityLiveRegion="polite">
          <StateMark kind="fault" /><T v="body" style={{ fontFamily: F.sansMedium }}>{error}</T>
        </View>
      ) : null}

      {/* Pending requests lead the list, with the `approve` glyph: that is what it means. */}
      {pending.map((a) => (
        <View key={a.app_id} style={{ borderTopWidth: 2, borderTopColor: C.fg, paddingTop: S[4], marginTop: S[6] }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: S[2] }}>
            <Glyph pattern="approve" size={34} playKey={a.app_id} />
            <T v="small" color={TONE.rose.text} style={{ marginBottom: 2 }}>waiting for you</T>
          </View>
          <T v="displayM" style={{ marginTop: S[2] }}>{a.name}</T>
          <T v="body">Wants to tap you</T>
          <T v="numS" color={C.fg3} style={{ marginTop: S[1] }}>{a.origin ?? 'unknown origin'}</T>
          <T v="small" style={{ marginTop: 2 }}>Asked {ago(a.created_at)}</T>
          <View style={{ flexDirection: 'row', gap: S[3], marginTop: S[4] }}>
            <Btn label="Approve" solid onPress={() => void act(approveApp, a.app_id)} style={{ flex: 1 }} />
            <Btn label="Decline" onPress={() => void act(revokeApp, a.app_id)} style={{ flex: 1 }} />
          </View>
        </View>
      ))}

      <Label style={{ marginTop: S[7] }}>Allowed</Label>
      {rest.length === 0 ? <T v="small" style={{ marginTop: S[2] }}>No apps yet.</T> : null}
      {rest.map((a) => (
        <View key={a.app_id} style={{ borderTopWidth: 1, borderTopColor: C.rule, paddingVertical: S[4], marginTop: S[2], opacity: a.status === 'revoked' ? 0.55 : 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: S[3] }}>
            <View style={{ flex: 1 }}>
              <T v="displayS">{a.name}</T>
              {a.origin ? <T v="numS" color={C.fg3} style={{ marginTop: 2 }}>{a.origin}</T> : null}
              <T v="small" style={{ marginTop: 2 }}>{a.status === 'revoked' ? 'Revoked' : `${a.buzzes} buzz${a.buzzes === 1 ? '' : 'es'}, last ${ago(a.last_used)}`}</T>
            </View>
            {a.status === 'approved'
              ? <Btn small label="Revoke" onPress={() => void act(revokeApp, a.app_id)} />
              : <Btn small label="Allow again" onPress={() => void act(approveApp, a.app_id)} />}
          </View>
        </View>
      ))}

      <Label style={{ marginTop: S[7] }}>Recent buzzes from apps</Label>
      {foreign.length === 0 ? <T v="small" style={{ marginTop: S[2] }}>None since the app opened.</T> : null}
      {foreign.map((b) => (
        <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: S[3], borderTopWidth: 1, borderTopColor: C.rule, paddingVertical: S[3], marginTop: S[2] }}>
          <View style={{ width: 72 }}><Glyph pattern={b.pattern} size={22} maxWidth={72} /></View>
          <View style={{ flex: 1 }}><T v="body">{b.label}</T><T v="small">{b.source_app}</T></View>
          <T v="numS" color={C.fg3}>{new Date(b.at).toTimeString().slice(0, 8)}</T>
        </View>
      ))}
    </Screen>
  );
}
