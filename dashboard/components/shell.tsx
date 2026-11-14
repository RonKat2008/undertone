'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { BandStatus } from '@/components/band-status';
import { Glyph } from '@/components/glyph';
import type { HapticPattern } from '@/lib/bus/contracts';
import { PATTERNS } from '@/lib/bus/patterns';
import { isLive } from '@/lib/bus/reducer';
import { BusProvider, useBus, useNow } from '@/lib/bus/use-bus';

const NAV = [
  { href: '/', label: 'Graph' },
  { href: '/conversations', label: 'Conversations' },
  { href: '/studio', label: 'Studio' },
  { href: '/debrief', label: 'Debrief' },
  { href: '/pair', label: 'Pair' },
  { href: '/calibration', label: 'Calibration' },
];
/** Live coaching belongs to the phone; the screen stays reachable for rehearsal, set apart. */
const LIVE = { href: '/live', label: 'Live' };

export const TAKEOVER_MS = 2800;

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <BusProvider>
      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col px-4 md:px-8">
        <Masthead />
        <main className="flex-1 pb-10">{children}</main>
      </div>
      <LiveOnly><NudgeTakeover /></LiveOnly>
    </BusProvider>
  );
}

function LiveOnly({ children }: { children: ReactNode }) {
  const path = usePathname();
  return path.startsWith(LIVE.href) ? <>{children}</> : null;
}

function Masthead() {
  const { state, send } = useBus();
  const path = usePathname();
  const onLive = path.startsWith(LIVE.href);
  const now = useNow(500);
  const live = isLive(state);
  const session = state.session;
  const elapsed = session ? ((session.endedAt ?? now) - session.startedAt) / 1000 : 0;
  const phone = Object.values(state.devices).find((d) => d.connected) ?? Object.values(state.devices)[0];
  const band = state.band;

  return (
    <header className="relative flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-ink py-3">
      <Link href="/" className="serif text-[26px] leading-none">Undertone</Link>
      <nav aria-label="Screens" className="flex flex-wrap gap-x-4 gap-y-1">
        {NAV.map((n) => {
          const active = n.href === '/' ? path === '/' : path.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined}
              className={`caps border-b pb-0.5 transition-colors hover:text-ink ${active ? 'border-ink !text-ink' : 'border-transparent'}`}>
              {n.label}
            </Link>
          );
        })}
        <span className="flex items-center gap-1.5 border-l border-rule pl-4">
          <Link href={LIVE.href} aria-current={onLive ? 'page' : undefined}
            className={`caps flex items-center gap-1.5 border-b pb-0.5 transition-colors hover:text-ink ${onLive ? 'border-ink !text-ink' : 'border-transparent !text-ink-3'}`}>
            {live && <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-vermilion" aria-label="A conversation is live" />}
            {LIVE.label}
          </Link>
        </span>
      </nav>
      {!onLive ? (
        <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px]">
          <BandStatus />
          <span className="flex items-center gap-1.5">
            <span className={`inline-block h-2 w-2 rounded-full ${phone?.connected ? 'bg-green' : 'border border-ink-3'}`} />
            <span className="caps">Phone</span>
            <span>{phone ? (phone.connected ? phone.name : 'offline') : 'not paired'}</span>
          </span>
          <span className={`caps rounded-sm border px-1.5 py-0.5 ${state.status === 'live' ? 'border-green !text-green' : state.status === 'offline' ? 'border-vermilion !text-vermilion' : 'border-rule'}`}>
            {state.status}
          </span>
        </div>
      ) : (
      <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1 text-[12px]">
        <StatusReply />
        <span className="hidden lg:inline"><span className="caps mr-1.5">Coach</span>{state.coach?.name ?? 'none'}</span>
        <span className="flex items-center gap-1.5" title={band?.mic_on ? 'The band’s light is solid blue: the mic is on' : 'Mic off'}>
          <span className={`inline-block h-2 w-2 rounded-full ${band?.mic_on ? 'live-dot bg-mic' : band?.connected ? 'bg-ink' : 'border border-ink-3'}`} />
          <span className="caps">Band</span>
          <span className="num">{band?.connected ? `${band.transport}${band.battery_pct !== null ? ` · ${Math.round(band.battery_pct)}%` : ''}` : 'off'}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-2 w-2 rounded-full ${phone?.connected ? 'bg-green' : 'border border-ink-3'}`} />
          <span className="caps">Phone</span>
          <span>{phone ? (phone.connected ? phone.name : 'offline') : 'not paired'}</span>
        </span>
        <span className={`caps rounded-sm border px-1.5 py-0.5 ${state.status === 'live' ? 'border-green !text-green' : state.status === 'offline' ? 'border-vermilion !text-vermilion' : 'border-rule'}`}>
          {state.status}
        </span>
        <span className="num w-12 text-right text-[18px] leading-none" aria-label="Session clock">{clock(elapsed)}</span>
        {live ? (
          <button className="btn btn-solid" onClick={() => send({ cmd: 'stop' })}>Stop</button>
        ) : (
          <span className="flex">
            <button className="btn btn-solid rounded-r-none" onClick={() => send({ cmd: 'start', mode: 'regular' })}>Start</button>
            <button className="btn -ml-px rounded-l-none" onClick={() => send({ cmd: 'start', mode: 'practice' })}>Practice</button>
          </span>
        )}
      </div>
      )}
    </header>
  );
}

/** "How am I doing?" The band was tapped once; this is the phone's answer. Smaller than a nudge. */
function StatusReply() {
  const { state } = useBus();
  const now = useNow(300);
  const m = state.lastStatus;
  if (!m || !m.pattern || now - m.at > 6000) return null;
  return (
    <span key={m.id} className="anim-rise flex items-center gap-2 border border-ink px-2 py-1" role="status">
      <Glyph pattern={m.pattern} size={14} playing playKey={m.id} />
      <span className="caps !text-ink">How am I doing?</span>
      <span className="serif text-[17px] leading-none">{m.title}</span>
    </span>
  );
}

/** The unmissable moment: a full-width band in the pattern's colour. */
function NudgeTakeover() {
  const { state } = useBus();
  const now = useNow(200);
  const [beat, setBeat] = useState(0);
  const m = state.lastNudge;
  const age = m ? now - m.at : Infinity;
  const visible = m !== null && m.pattern !== null && age < TAKEOVER_MS + 400;
  const pattern = (m?.pattern ?? 'tap') as HapticPattern;
  const spec = PATTERNS[pattern];

  useEffect(() => {
    if (!visible) return;
    const id = setInterval(() => setBeat((b) => b + 1), spec.total + 1200);
    return () => clearInterval(id);
  }, [visible, spec.total, m?.id]);

  if (!visible || !m) return null;
  const leaving = age >= TAKEOVER_MS;
  const facts = [m.detail, m.confidence !== null ? `confidence ${m.confidence.toFixed(2)}` : null, m.latency_ms !== null && m.latency_ms >= 50 ? `slip → tap ${(m.latency_ms / 1000).toFixed(1)} s` : null].filter(Boolean);
  return (
    <div
      key={m.id}
      role="alert"
      className={`tone-${spec.tone} fixed inset-x-0 top-0 z-40 flex min-h-[46vh] items-center overflow-hidden px-6 py-10 md:px-16`}
      style={{ background: 'var(--tone)', color: 'var(--tone-on)', animation: leaving ? 'fold-out 380ms ease-in both' : 'drop-in 240ms cubic-bezier(.2,.8,.2,1) both' }}
    >
      <div className="mx-auto flex w-full max-w-[1500px] flex-wrap items-end gap-x-16 gap-y-8">
        <Glyph pattern={pattern} size={150} playing playKey={`${m.id}-${beat}`} mono className="max-w-full" />
        <div className="min-w-0">
          <div className="caps mb-3" style={{ color: 'inherit', opacity: 0.8 }}>{spec.name} · {spec.feel.toLowerCase()}</div>
          <div className="serif text-[clamp(64px,11vw,176px)] leading-[0.9]">{m.title}</div>
          <div className="num mt-6 flex flex-wrap gap-x-8 gap-y-1 text-[clamp(14px,1.5vw,22px)]">
            {facts.map((f) => <span key={f}>{f}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}
