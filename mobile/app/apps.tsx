import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { approveApp, listApps, revokeApp, type AppInfo } from '@/api/client';
import { useBus } from '@/bus/use-bus';
import { Glyph } from '@/ui/Glyph';
import { Header } from '@/ui/Header';
import { Btn, Screen, T } from '@/ui/kit';
import { NotPaired } from '@/ui/States';
import { C, TONE } from '@/ui/theme';

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
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const r = await listApps();
    if (r.kind === 'ok') { setApps(r.data); setError(null); } else if (r.kind === 'error') setError(r.message);
  }, []);
  const requests = state.appRequests.length;
  useEffect(() => {
    if (mode === 'unpaired') return;
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

  if (mode === 'unpaired') return <Screen><Header title="Connected apps" /><NotPaired /></Screen>;
  return (
    <Screen>
      <Header title="Connected apps" />
      <T v="small">Any site or app can ask to tap you. Nothing buzzes until you say yes here, and you can take it back.</T>
      {error ? <T v="small" color={TONE.vermilion} style={{ marginTop: 10 }}>{error}</T> : null}

      {pending.map((a) => (
        <View key={a.app_id} style={{ borderWidth: 1.5, borderColor: C.paper, padding: 16, marginTop: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Glyph pattern="approve" size={20} playKey={a.app_id} /><T v="caps" color={C.paper}>Wants to tap you</T></View>
          <T v="serif" size={36} style={{ marginTop: 6 }}>{a.name}</T>
          <T v="mono" size={12} color={C.paper3}>{a.origin ?? 'unknown origin'} · asked {ago(a.created_at)}</T>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
            <Btn label="Approve" solid onPress={() => void act(approveApp, a.app_id)} style={{ flex: 1 }} />
            <Btn label="Decline" onPress={() => void act(revokeApp, a.app_id)} style={{ flex: 1 }} />
          </View>
        </View>
      ))}

      <T v="caps" color={C.paper} style={{ marginTop: 26 }}>Allowed</T>
      {rest.length === 0 ? <T v="small" style={{ marginTop: 6 }}>No apps yet.</T> : null}
      {rest.map((a) => (
        <View key={a.app_id} style={{ borderTopWidth: 1, borderTopColor: C.rule, paddingVertical: 14, marginTop: 8, opacity: a.status === 'revoked' ? 0.5 : 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
            <View style={{ flex: 1 }}>
              <T v="serif" size={28}>{a.name}</T>
              <T v="small">{a.status === 'revoked' ? 'Revoked' : `${a.buzzes} buzz${a.buzzes === 1 ? '' : 'es'} · last ${ago(a.last_used)}`}</T>
            </View>
            {a.status === 'approved'
              ? <Btn small label="Revoke" onPress={() => void act(revokeApp, a.app_id)} />
              : <Btn small label="Allow again" onPress={() => void act(approveApp, a.app_id)} />}
          </View>
        </View>
      ))}

      <T v="caps" color={C.paper} style={{ marginTop: 26 }}>Recent buzzes from apps</T>
      {foreign.length === 0 ? <T v="small" style={{ marginTop: 6 }}>None since the app opened.</T> : null}
      {foreign.map((b) => (
        <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderTopWidth: 1, borderTopColor: C.rule, paddingVertical: 10, marginTop: 6 }}>
          <View style={{ width: 70 }}><Glyph pattern={b.pattern} size={18} maxWidth={70} /></View>
          <View style={{ flex: 1 }}><T v="body" size={15}>{b.label}</T><T v="small">{b.source_app}</T></View>
          <T v="mono" size={12} color={C.paper3}>{new Date(b.at).toTimeString().slice(0, 8)}</T>
        </View>
      ))}
    </Screen>
  );
}
