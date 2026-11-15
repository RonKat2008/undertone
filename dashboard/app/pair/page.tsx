'use client';

import qrcode from 'qrcode-generator';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Glyph } from '@/components/glyph';
import { approveApp, createPairing, listApps, listDevices, revokeApp, testBuzz, type AppInfo, type DeviceInfo, type Pairing } from '@/lib/api/client';
import type { HapticPattern } from '@/lib/bus/contracts';
import { PATTERNS, PATTERN_ORDER } from '@/lib/bus/patterns';
import { useBus } from '@/lib/bus/use-bus';

function QR({ text, size = 280 }: { text: string; size?: number }) {
  const cells = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
    return { n, d };
  }, [text]);
  return (
    <svg width={size} height={size} viewBox={`-2 -2 ${cells.n + 4} ${cells.n + 4}`} role="img" aria-label="Pairing QR code" shapeRendering="crispEdges">
      <rect x={-2} y={-2} width={cells.n + 4} height={cells.n + 4} fill="var(--paper)" />
      <path d={cells.d} fill="var(--ink)" />
    </svg>
  );
}

function ago(seconds: number | null): string {
  if (!seconds) return 'never';
  const s = Math.max(0, Date.now() / 1000 - seconds);
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 129600) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

export default function PairPage() {
  const { state, resolveApp } = useBus();
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[] | null>(null);
  const [apps, setApps] = useState<AppInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [played, setPlayed] = useState<{ pattern: HapticPattern; n: number; note: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [d, a] = await Promise.all([listDevices(), listApps()]);
      setDevices(d); setApps(a); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot reach the backend.');
    }
  }, []);

  const newPairing = useCallback(() => {
    setPairingError(null);
    createPairing()
      .then((p) => { setPairing(p); setPairingError(null); })
      .catch((e) => { setPairing(null); setPairingError(e instanceof Error ? e.message : 'Could not create a pairing.'); });
  }, []);

  useEffect(() => {
    newPairing();
    void refresh();
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [newPairing, refresh]);

  // a device.status or app.request on the bus means the lists changed
  const busKey = `${Object.values(state.devices).map((d) => `${d.device_id}${d.connected}`).join()}|${state.appRequests.length}`;
  useEffect(() => { void refresh(); }, [busKey, refresh]);

  const act = async (fn: () => Promise<void>, app_id: string) => { try { await fn(); resolveApp(app_id); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : 'That did not work.'); } };
  const pending = (apps ?? []).filter((a) => a.status === 'pending');
  const rest = (apps ?? []).filter((a) => a.status !== 'pending');
  const thisPhone = pairing ? devices?.find((d) => d.device_id === pairing.device_id) : undefined;
  const phones = (devices ?? []).filter((d) => d.paired || d.connected);

  async function play(pattern: HapticPattern) {
    let note: string;
    try { const n = await testBuzz(pattern, PATTERNS[pattern].action); note = n ? `sent to ${n} phone${n > 1 ? 's' : ''}` : 'no phone connected'; } catch { note = 'backend unreachable'; }
    setPlayed((p) => ({ pattern, n: (p?.n ?? 0) + 1, note }));
  }

  const groups: { title: string; group: 'nudge' | 'status' | 'system' }[] = [
    { title: 'Nudges', group: 'nudge' },
    { title: 'How am I doing?', group: 'status' },
    { title: 'System', group: 'system' },
  ];

  return (
    <div className="pt-8">
      <div className="mb-6 flex items-center gap-3"><span className="label">Pair and devices</span></div>
      {error && <p role="alert" className="text-m mb-4 flex items-center gap-2 font-medium text-ink"><span className="state state-fault" aria-hidden />{error}</p>}
      <div className="grid gap-x-6 gap-y-12 xl:grid-cols-12">
        <section aria-label="Pair a phone" className="xl:col-span-5">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-6">
            <div className="border border-rule p-3">{pairing ? <QR text={pairing.qr} size={232} /> : <div className="h-[232px] w-[232px] bg-well" />}</div>
            <div className="pb-1">
              <div className="label mb-1">Or type this code</div>
              <div className="num-l tracking-[0.06em]">{pairing ? `${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}` : '··· ···'}</div>
              <button className="btn btn-sm btn-quiet mt-4" onClick={newPairing}>{pairingError ? 'Try again' : 'New code'}</button>
            </div>
          </div>
          {pairingError && <p role="alert" className="text-m mt-5 flex max-w-[44ch] items-start gap-2 font-medium text-ink"><span className="state state-fault mt-[7px]" aria-hidden />No pairing code: {pairingError.replace(/\.$/, '')}. Start the laptop backend, then try again.</p>}
          <p className="text-m mt-5 max-w-[44ch] text-ink-2">
            Open Undertone on the iPhone and scan.{' '}
            {!pairing ? null : thisPhone?.connected
              ? <span className="inline-flex items-center gap-2 text-ink"><span className="state state-on" aria-hidden />This phone is connected.</span>
              : 'Waiting for the phone…'}
          </p>
          {pairing && <p className="num-s mt-1 text-ink-3">server {pairing.server_url}</p>}
        </section>

        <div className="space-y-12 xl:col-span-6 xl:col-start-7">
          <section aria-label="Phones">
            <h2 className="display-s border-b border-ink pb-2">Phones</h2>
            {devices === null && <p className="text-m py-3 text-ink-3">{error ? 'Unknown until the backend answers.' : 'Loading…'}</p>}
            {devices !== null && phones.length === 0 && <p className="text-m py-3 text-ink-3">No phone has paired yet.</p>}
            {phones.map((d) => (
              <div key={d.device_id} className="grid grid-cols-[20px_1fr_auto] items-center gap-x-3 border-b border-rule py-3.5">
                <span className={`state ${d.connected ? 'state-on' : ''}`} aria-hidden />
                <span className="display-s">{d.name}</span>
                <span className="text-s text-ink-2">{d.connected ? 'connected, ready to buzz' : `last seen ${ago(d.last_seen)}`}</span>
              </div>
            ))}
          </section>

          <section aria-label="Connected apps">
            <h2 className="display-s border-b border-ink pb-2">Connected apps <span className="text-s ml-2 text-ink-2">who else may tap you</span></h2>
            {pending.map((a) => (
              <div key={a.app_id} className="anim-rise flex flex-wrap items-center justify-between gap-4 border-b border-rule py-4">
                <div className="flex items-center gap-5">
                  <Glyph pattern="approve" size={34} playing playKey={a.app_id} />
                  <div>
                    <div className="display-s">{a.name}</div>
                    <div className="text-s text-rose-text">waiting for you</div>
                    <div className="num-s text-ink-3">{a.origin ?? 'unknown origin'}, asked {ago(a.created_at)}</div>
                  </div>
                </div>
                <div className="flex gap-2"><button className="btn btn-solid" onClick={() => act(() => approveApp(a.app_id), a.app_id)}>Approve</button><button className="btn" onClick={() => act(() => revokeApp(a.app_id), a.app_id)}>Decline</button></div>
              </div>
            ))}
            {rest.map((a) => (
              <div key={a.app_id} className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-rule py-3.5 ${a.status === 'revoked' ? 'text-ink-3' : ''}`}>
                <div className="min-w-0 flex-1"><span className="display-s">{a.name}</span><span className="num-s ml-3 text-ink-3">{a.origin ?? ''}</span></div>
                <span className="text-s text-ink-2">{a.status === 'revoked' ? 'revoked' : <><span className="num-s text-ink">{a.buzzes}</span> buzzes, last {ago(a.last_used)}</>}</span>
                {a.status === 'approved'
                  ? <button className="btn btn-sm btn-quiet" onClick={() => act(() => revokeApp(a.app_id), a.app_id)}>Revoke</button>
                  : <button className="btn btn-sm btn-quiet" onClick={() => act(() => approveApp(a.app_id), a.app_id)}>Allow again</button>}
              </div>
            ))}
            {apps === null && <p className="text-m py-3 text-ink-3">{error ? 'Unknown until the backend answers.' : 'Loading…'}</p>}
            {apps !== null && apps.length === 0 && <p className="text-m py-3 text-ink-3">No app has asked yet. An app that wants to tap you shows up here for your approval.</p>}
          </section>
        </div>
      </div>

      <section className="mt-20" aria-label="Haptic vocabulary">
        <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-ink pb-2">
          <h2 className="display-s">The vocabulary <span className="text-s ml-2 text-ink-2">eleven patterns</span></h2>
          <span className="text-s text-ink-2">{played ? <><span className="num-s text-ink">{played.pattern}</span> {played.note}</> : 'click a row to play it'}</span>
        </div>
        <div className="grid gap-x-6 xl:grid-cols-12">
          {[['nudge'], ['status', 'system']].map((col) => (
            <div key={col[0]} className="xl:col-span-6">
              {groups.filter((g) => col.includes(g.group)).map((g) => (
                <div key={g.group}>
                  <h3 className="label mb-1 mt-6">{g.title}</h3>
                  {PATTERN_ORDER.filter((p) => PATTERNS[p].group === g.group).map((p) => {
                    const s = PATTERNS[p];
                    return (
                      <button key={p} onClick={() => play(p)} className="grid w-full grid-cols-[168px_minmax(0,1fr)] items-center gap-x-5 border-b border-rule py-3 text-left hover:bg-well">
                        <span className="flex h-[40px] items-end pl-1"><Glyph pattern={p} size={34} playing={played?.pattern === p} playKey={played?.n} /></span>
                        <span className="min-w-0">
                          <span className="display-s block leading-tight">{s.action}</span>
                          <span className="text-s text-ink-2">{s.feel.toLowerCase()}</span> <span className="num-s text-ink-3">{p}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
