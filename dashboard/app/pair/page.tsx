'use client';

import qrcode from 'qrcode-generator';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Glyph } from '@/components/glyph';
import { SampleTag } from '@/components/sample-tag';
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
  const { state, kind, resolveApp } = useBus();
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [apps, setApps] = useState<AppInfo[]>([]);
  const [sample, setSample] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [played, setPlayed] = useState<{ pattern: HapticPattern; n: number; note: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [d, a] = await Promise.all([listDevices(), listApps()]);
      setDevices(d.data); setApps(a.data); setSample(d.sample); setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot reach the backend.');
    }
  }, []);

  const newPairing = useCallback(() => {
    createPairing().then(setPairing).catch((e) => setError(e instanceof Error ? e.message : 'Could not create a pairing.'));
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
  const pending = apps.filter((a) => a.status === 'pending');
  const rest = apps.filter((a) => a.status !== 'pending');
  const thisPhone = pairing ? devices.find((d) => d.device_id === pairing.device_id) : undefined;

  async function play(pattern: HapticPattern) {
    let note = 'shown here only';
    if (kind !== 'mock') {
      try { const n = await testBuzz(pattern, PATTERNS[pattern].action); note = n ? `sent to ${n} phone${n > 1 ? 's' : ''}` : 'no phone connected'; } catch { note = 'backend unreachable'; }
    }
    setPlayed((p) => ({ pattern, n: (p?.n ?? 0) + 1, note }));
  }

  return (
    <div className="pt-8">
      <div className="caps mb-4 flex items-center gap-3">Pair and devices <SampleTag show={sample} /></div>
      {error && <p role="alert" className="mb-4 text-[13px] text-vermilion">{error}</p>}
      <div className="grid gap-x-16 gap-y-12 lg:grid-cols-[auto_minmax(0,1fr)]">
        <section aria-label="Pair a phone">
          <div className="border border-ink p-5">{pairing ? <QR text={pairing.qr} /> : <div className="h-[280px] w-[280px] bg-well" />}</div>
          <div className="mt-4 flex items-end justify-between">
            <div><div className="caps">Or type this code</div><div className="num text-[44px] leading-none tracking-[0.08em]">{pairing ? `${pairing.code.slice(0, 3)} ${pairing.code.slice(3)}` : '··· ···'}</div></div>
            <button className="btn btn-sm btn-quiet" onClick={newPairing}>New code</button>
          </div>
          <p className="mt-3 max-w-[320px] text-[12.5px] text-ink-2">
            Open Undertone on the iPhone and scan. {thisPhone?.connected ? <span className="text-green">This phone is connected.</span> : 'Waiting for the phone…'}
            {pairing && <span className="num mt-1 block text-[11px] tracking-normal text-ink-3">server {pairing.server_url}</span>}
          </p>
        </section>

        <div className="space-y-12">
          <section aria-label="Phones">
            <h2 className="caps border-b border-ink pb-2 !text-ink">Phones</h2>
            {devices.filter((d) => d.paired || d.connected).length === 0 && <p className="py-3 text-ink-3">No phone has paired yet.</p>}
            {devices.filter((d) => d.paired || d.connected).map((d) => (
              <div key={d.device_id} className="grid grid-cols-[16px_1fr_auto] items-center gap-x-3 border-b border-rule py-3">
                <span className={`h-2.5 w-2.5 rounded-full ${d.connected ? 'bg-green' : 'border border-ink-3'}`} />
                <span className="serif text-[26px] leading-none">{d.name}</span>
                <span className="caps">{d.connected ? 'connected · ready to buzz' : `last seen ${ago(d.last_seen)}`}</span>
              </div>
            ))}
          </section>

          <section aria-label="Connected apps">
            <h2 className="caps border-b border-ink pb-2 !text-ink">Connected apps · who else may tap you</h2>
            {pending.map((a) => (
              <div key={a.app_id} className="anim-rise my-3 flex flex-wrap items-center justify-between gap-4 border-2 border-ink p-4">
                <div className="flex items-center gap-4">
                  <Glyph pattern="approve" size={22} playing playKey={a.app_id} />
                  <div><div className="caps !text-ink">Waiting for your approval</div><div className="serif text-[28px] leading-none">{a.name}</div>
                    <div className="num mt-1 text-[11px] tracking-normal text-ink-3">{a.origin ?? 'unknown origin'} · asked {ago(a.created_at)}</div></div>
                </div>
                <div className="flex gap-2"><button className="btn btn-solid" onClick={() => act(() => approveApp(a.app_id), a.app_id)}>Approve</button><button className="btn" onClick={() => act(() => revokeApp(a.app_id), a.app_id)}>Decline</button></div>
              </div>
            ))}
            {rest.map((a) => (
              <div key={a.app_id} className={`flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-b border-rule py-3 ${a.status === 'revoked' ? 'opacity-50' : ''}`}>
                <div className="min-w-0 flex-1"><span className="serif text-[24px] leading-none">{a.name}</span><span className="num ml-3 text-[11px] tracking-normal text-ink-3">{a.origin ?? ''}</span></div>
                <span className="caps">{a.status === 'revoked' ? 'revoked' : `${a.buzzes} buzzes · last ${ago(a.last_used)}`}</span>
                {a.status === 'approved'
                  ? <button className="btn btn-sm btn-quiet" onClick={() => act(() => revokeApp(a.app_id), a.app_id)}>Revoke</button>
                  : <button className="btn btn-sm btn-quiet" onClick={() => act(() => approveApp(a.app_id), a.app_id)}>Allow again</button>}
              </div>
            ))}
            {apps.length === 0 && <p className="py-3 text-ink-3">No app has asked yet. Open the slide timer in sdk/demo to see a request arrive.</p>}
          </section>
        </div>
      </div>

      <section className="mt-14" aria-label="Haptic vocabulary">
        <div className="flex items-baseline justify-between border-b border-ink pb-2">
          <h2 className="caps !text-ink">The vocabulary · eleven patterns</h2>
          <span className="caps">{played ? `${played.pattern} · ${played.note}` : 'click a row to play it'}</span>
        </div>
        <div className="grid gap-x-14 md:grid-cols-2">
          {PATTERN_ORDER.map((p) => {
            const s = PATTERNS[p];
            return (
              <button key={p} onClick={() => play(p)} className="group grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-4 border-b border-rule py-2.5 text-left hover:bg-well sm:grid-cols-[130px_120px_minmax(0,1fr)]">
                <Glyph pattern={p} size={24} playing={played?.pattern === p} playKey={played?.n} />
                <span className="num hidden text-[12px] tracking-normal text-ink-2 sm:inline">{p}</span>
                <span><span className="serif text-[20px] leading-none">{s.action}</span><span className="ml-3 text-[12px] text-ink-3">{s.feel.toLowerCase()}</span></span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
