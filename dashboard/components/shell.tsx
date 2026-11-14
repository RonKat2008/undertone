'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Glyph } from '@/components/glyph';
import type { HapticPattern } from '@/lib/bus/contracts';
import { PATTERNS, PATTERN_ORDER } from '@/lib/bus/patterns';
import { isLive } from '@/lib/bus/reducer';
import { BusProvider, useBus, useNow } from '@/lib/bus/use-bus';

const NAV = [
  { href: '/', label: 'Live' },
  { href: '/studio', label: 'Studio' },
  { href: '/debrief', label: 'Debrief' },
  { href: '/pair', label: 'Pair' },
  { href: '/calibration', label: 'Calibration' },
];

/** How long a takeover holds (DESIGN.md §5.1 --dur-hold). Practice `success` holds 1500 ms (§5.3). */
export const TAKEOVER_MS = 2500;
const PRACTICE_SUCCESS_MS = 1500;
const EXIT_MS = 200;
/** "How am I doing?" reply strip: holds 3 s, then folds. */
const STATUS_MS = 3000;

export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <BusProvider>
      <div className="frame mx-auto flex min-h-screen max-w-[1680px] flex-col">
        <Masthead />
        <main className="flex-1 pb-16">{children}</main>
      </div>
      <NudgeTakeover />
      <Director />
    </BusProvider>
  );
}

function Masthead() {
  const { state, send } = useBus();
  const path = usePathname();
  const now = useNow(500);
  const live = isLive(state);
  const session = state.session;
  const elapsed = session ? ((session.endedAt ?? now) - session.startedAt) / 1000 : 0;
  const phone = Object.values(state.devices).find((d) => d.connected) ?? Object.values(state.devices)[0];
  const band = state.band;

  return (
    <header className="relative z-30 flex min-h-14 flex-wrap items-center gap-x-8 gap-y-2 border-b border-ink py-2.5">
      <Link href="/" className="serif text-[26px] leading-none tracking-[-0.01em]">Undertone</Link>
      <nav aria-label="Screens" className="flex gap-5">
        {NAV.map((n) => {
          const active = n.href === '/' ? path === '/' : path.startsWith(n.href);
          return (
            <Link key={n.href} href={n.href} aria-current={active ? 'page' : undefined}
              className={`text-s border-b-2 pb-0.5 ${active ? 'border-ink text-ink' : 'border-transparent text-ink-2 hover:text-ink'}`}>
              {n.label}
            </Link>
          );
        })}
      </nav>
      <div className="text-s ml-auto flex flex-wrap items-center gap-x-6 gap-y-1.5">
        <span className="hidden text-ink-2 xl:inline"><span className="text-ink">{state.coach?.name ?? 'No'}</span> coach</span>
        <span className="flex items-center gap-2" title={band?.connected ? `Band over ${band.transport}${band.battery_pct !== null ? `, battery ${Math.round(band.battery_pct)}%` : ''}` : 'Band not connected'}>
          <span className={`state ${band?.mic_on ? 'state-listening' : band?.connected ? 'state-on' : ''}`} aria-hidden />
          <span className={band?.connected ? 'text-ink' : 'text-ink-2'}>{band?.mic_on ? 'Listening' : band?.connected ? 'Band' : 'Band off'}</span>
          {band?.connected && band.battery_pct !== null && <span className="num-s text-ink-3">{Math.round(band.battery_pct)}%</span>}
        </span>
        <span className="flex items-center gap-2">
          <span className={`state ${phone?.connected ? 'state-on' : ''}`} aria-hidden />
          <span className={phone?.connected ? 'text-ink' : 'text-ink-2'}>{phone ? (phone.connected ? phone.name : 'Phone offline') : 'No phone'}</span>
        </span>
        <FeedState status={state.status} />
        <span className="num-m w-[4.2ch] text-right" aria-label="Session clock">{clock(elapsed)}</span>
        {live ? (
          <button className="btn btn-solid" onClick={() => send({ cmd: 'stop' })}>Stop</button>
        ) : (
          <span className="flex">
            <button className="btn btn-solid rounded-r-none" onClick={() => send({ cmd: 'start', mode: 'regular' })}>Start</button>
            <button className="btn -ml-px rounded-l-none" onClick={() => send({ cmd: 'start', mode: 'practice' })}>Practice</button>
          </span>
        )}
      </div>
      <StatusReply />
    </header>
  );
}

function FeedState({ status }: { status: string }) {
  if (status === 'mock') return <span className="sample-tag" title="Scripted mock feed. Nothing leaves this browser.">mock feed</span>;
  if (status === 'offline') return <span className="flex items-center gap-2 font-medium text-ink"><span className="state state-fault" aria-hidden />Offline</span>;
  if (status === 'connecting') return <span className="flex items-center gap-2 text-ink-2"><span className="state" aria-hidden />Connecting</span>;
  return null;
}

/** "How am I doing?" The band was tapped once; this is the phone's answer. A strip, never a takeover. */
function StatusReply() {
  const { state } = useBus();
  const now = useNow(200);
  const m = state.lastStatus;
  if (!m || !m.pattern) return null;
  const age = now - m.at;
  if (age > STATUS_MS + EXIT_MS) return null;
  const leaving = age >= STATUS_MS;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-full h-16 overflow-hidden" role="status">
      <div key={m.id} className="flex h-16 items-center gap-5 border-b border-rule bg-paper"
        style={{ animation: leaving ? `fold-out ${EXIT_MS}ms var(--ease-exit) both` : `drop-in var(--dur-enter) var(--ease-enter) both` }}>
        <Glyph pattern={m.pattern} size={24} playing playKey={m.id} />
        <span className="label">How am I doing?</span>
        <span className="display-s">{m.title}</span>
      </div>
    </div>
  );
}

/** The unmissable moment: a full-width band of the pattern's solid. It covers content; it doesn't float. */
function NudgeTakeover() {
  const { state } = useBus();
  const now = useNow(100);
  const m = state.lastNudge;
  const practice = state.session?.mode === 'practice';
  // Practice is strict for the wrist and calm for the eye: only `success` takes over (§5.3).
  const eligible = m !== null && m.pattern !== null && (!practice || m.pattern === 'success');
  const hold = practice ? PRACTICE_SUCCESS_MS : TAKEOVER_MS;
  const age = m ? now - m.at : Infinity;
  if (!eligible || !m || age >= hold + EXIT_MS) return null;
  const pattern = m.pattern as HapticPattern;
  const spec = PATTERNS[pattern];
  const leaving = age >= hold;
  const facts = [
    m.detail,
    m.confidence !== null ? `confidence ${m.confidence.toFixed(2)}` : null,
    m.latency_ms !== null && m.latency_ms >= 50 ? `slip → tap ${(m.latency_ms / 1000).toFixed(1)} s` : null,
  ].filter(Boolean) as string[];
  return (
    <div
      key={m.id}
      role="alert"
      className={`tone-${spec.tone} frame fixed inset-x-0 top-0 z-40 border-b border-ink`}
      style={{ background: 'var(--tone)', color: 'var(--tone-on)', animation: leaving ? `fold-out ${EXIT_MS}ms var(--ease-exit) both` : 'drop-in var(--dur-enter) var(--ease-enter) both' }}
    >
      <div className="mx-auto grid max-w-[1568px] items-end gap-x-14 gap-y-6 pb-12 pt-16 md:grid-cols-[auto_minmax(0,1fr)] md:pb-14 md:pt-20">
        <Glyph pattern={pattern} size={200} playing playKey={m.id} mono className="hidden max-w-full md:block" />
        <Glyph pattern={pattern} size={96} playing playKey={m.id} mono className="md:hidden" />
        <div className="min-w-0">
          <div className="display-xl">{m.title}</div>
          <div className="num-m mt-6 flex flex-wrap gap-x-10 gap-y-1">
            {facts.map((f) => <span key={f}>{f}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Hidden rehearsal panel. Toggle with the backtick key. */
function Director() {
  const { state, send, kind } = useBus();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === '`') setOpen((o) => !o);
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!open) return null;
  return (
    <aside aria-label="Director panel" className="anim-rise fixed bottom-4 right-4 z-50 w-[372px] max-w-[calc(100vw-32px)] border border-rule-strong bg-well p-5" style={{ boxShadow: 'var(--shadow-panel)' }}>
      <div className="mb-4 flex items-baseline justify-between">
        <span className="display-s">Director</span>
        <span className="text-s text-ink-2">{kind === 'mock' ? 'Mock feed' : 'Live backend'}, <kbd className="num-s">`</kbd> to close</span>
      </div>
      <div className="space-y-4">
        <Row label="Session">
          <B onClick={() => send({ cmd: 'start', mode: 'regular' })}>Start regular</B>
          <B onClick={() => send({ cmd: 'start', mode: 'practice' })}>Start practice</B>
          <B onClick={() => send({ cmd: 'stop' })}>Stop</B>
          <B onClick={() => send({ cmd: 'debrief' })}>Jump to debrief</B>
          {kind === 'mock' && <B onClick={() => send({ cmd: 'replay' })}>Replay script</B>}
        </Row>
        <Row label="Nudge">
          {PATTERN_ORDER.filter((p) => PATTERNS[p].group === 'nudge').map((p) => (
            <button key={p} className="btn btn-sm" onClick={() => send({ cmd: 'nudge', pattern: p })} title={PATTERNS[p].action}>
              <Glyph pattern={p} size={18} /> <span className="num-s">{p}</span>
            </button>
          ))}
        </Row>
        <Row label="How am I doing?">
          <B onClick={() => send({ cmd: 'status', verdict: 'good' })}>1 good</B>
          <B onClick={() => send({ cmd: 'status', verdict: 'talking_too_much' })}>2 talking</B>
          <B onClick={() => send({ cmd: 'status', verdict: 'ask_question' })}>3 ask</B>
        </Row>
        <Row label="Marks">
          <B onClick={() => send({ cmd: 'bookmark' })}>Bookmark</B>
          <B onClick={() => send({ cmd: 'signal', kind: 'nerves' })}>Nerves</B>
          <B onClick={() => send({ cmd: 'signal', kind: 'checked_out' })}>Checked out</B>
        </Row>
        <Row label="Hands">
          <B onClick={() => send({ cmd: 'motion', state: 'still' })}>Still</B>
          <B onClick={() => send({ cmd: 'motion', state: 'gesture' })}>Gesture</B>
          <B onClick={() => send({ cmd: 'motion', state: 'fidget' })}>Fidget</B>
        </Row>
      </div>
      <p className="text-s mt-4 text-ink-2">
        {state.status === 'live' ? 'Test nudges buzz the paired phone. They also show on this screen when the backend runs with DEV=1.' : 'Everything here is scripted. Nothing leaves this browser.'}
      </p>
    </aside>
  );
}

function B({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button className="btn btn-sm" onClick={onClick}>{children}</button>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="label mb-1.5">{label}</div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}
