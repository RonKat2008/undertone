'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { conversationHref, LIBRARY_HREF } from '@/lib/conversations/links';
import { clock } from '@/components/shell';
import { findConversation, getDebrief, listSessions, mediaUrl, type DebriefPayload } from '@/lib/api/client';
import type { Debrief, TimelinePoint } from '@/lib/bus/contracts';
import type { Mark, TurnView } from '@/lib/bus/reducer';
import { useBus, useNow } from '@/lib/bus/use-bus';
import { reasonLabel } from '@/lib/conversations/model';

/** After a conversation ends, how long to show "Writing the debrief…" before saying there is none. */
const DEBRIEF_WAIT_MS = 90_000;

type Load =
  | { state: 'loading' }
  | { state: 'ok'; payload: DebriefPayload }
  | { state: 'none'; sessionId: string | null; reason: string | null }
  | { state: 'error'; message: string };

export default function DebriefPage() {
  const { state } = useBus();
  const now = useNow(1000);
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // ?session=<id> (linked from the graph) asks for one stored conversation, not the latest.
  const [requested] = useState<string | null>(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('session')));
  const live = state.debrief && (!requested || state.debrief.session_id === requested) ? state.debrief : null;
  // A conversation on the bus that this page is about, still running or just ended without its debrief yet.
  const pendingSession = state.session && (!requested || state.session.id === requested) && live?.session_id !== state.session.id ? state.session : null;
  const waiting = pendingSession !== null && (pendingSession.endedAt === null || now - pendingSession.endedAt < DEBRIEF_WAIT_MS);
  const waitKey = waiting ? 'waiting' : pendingSession ? `gave-up-${pendingSession.id}` : 'idle';

  useEffect(() => {
    if (live) return;
    let on = true;
    setLoad({ state: 'loading' });
    void loadStored(requested).then((r) => on && setLoad(r));
    return () => { on = false; };
  }, [live, requested, attempt, waitKey]);

  if (live) {
    // The transcript and marks on the bus belong to this debrief only if no newer session replaced them.
    const own = state.session?.id === live.session_id;
    return <DebriefView sessionId={live.session_id} d={live.data} audio={mediaUrl(live.audio_url)} turns={own ? state.turns : []} marks={own ? state.marks : []} />;
  }
  if (load.state === 'ok') return <DebriefView sessionId={load.payload.session_id} d={load.payload.data} audio={mediaUrl(load.payload.audio_url)} turns={[]} marks={[]} />;
  if (waiting && load.state === 'none') return <Waiting running={pendingSession?.endedAt === null} />;
  if (load.state === 'loading') return <p className="serif pt-16 text-[32px] text-ink-3">Fetching the debrief…</p>;
  if (load.state === 'error') return <Unreachable message={load.message} onRetry={() => setAttempt((a) => a + 1)} />;
  return <NoDebrief sessionId={load.sessionId} reason={load.reason} />;
}

/** The requested stored debrief, or the newest kept conversation's; 'none' when there is no debrief to show. */
async function loadStored(requested: string | null): Promise<Load> {
  let id = requested;
  if (!id) {
    const sessions = await listSessions();
    if (!sessions.ok) return { state: 'error', message: sessions.error };
    const newest = sessions.data.find((s) => s.kept !== false);
    if (!newest) return { state: 'none', sessionId: null, reason: null };
    id = newest.session_id;
  }
  const r = await getDebrief(id);
  if (r.kind === 'ok') return { state: 'ok', payload: r.data };
  if (r.kind === 'error') return { state: 'error', message: r.message };
  const summary = await findConversation(id).catch(() => null);
  return { state: 'none', sessionId: id, reason: summary ? reasonLabel(summary) : null };
}

function Waiting({ running }: { running: boolean }) {
  return (
    <div className="pt-16" aria-live="polite">
      <div className="caps">Debrief</div>
      <p className="serif mt-2 text-[clamp(34px,4.6vw,56px)] leading-none text-ink-3">{running ? 'A conversation is going on.' : 'Writing the debrief…'}</p>
      <p className="mt-4 max-w-[52ch] text-[14px] text-ink-2">{running ? 'The debrief lands here a few seconds after it ends.' : 'It usually takes a few seconds after a conversation ends.'}</p>
    </div>
  );
}

function NoDebrief({ sessionId, reason }: { sessionId: string | null; reason: string | null }) {
  if (!sessionId) {
    return (
      <div className="pt-16">
        <div className="caps">Debrief</div>
        <p className="serif mt-2 max-w-[22ch] text-[clamp(38px,5vw,64px)] leading-[0.98]">No debriefs yet.</p>
        <p className="mt-4 max-w-[52ch] text-[14px] text-ink-2">Wear the band and talk. When a conversation ends, its debrief shows up here on its own.</p>
      </div>
    );
  }
  return (
    <div className="pt-16">
      <div className="caps">Debrief</div>
      <p className="serif mt-2 max-w-[22ch] text-[clamp(38px,5vw,64px)] leading-[0.98]">No debrief for this one.</p>
      <p className="mt-4 max-w-[52ch] text-[14px] text-ink-2">
        {reason ? `It was filtered out (${reason}), so the coach did not write one.` : 'The conversation closed without a debrief. The words, if any were captured, are still there.'}
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href={conversationHref(sessionId)} className="btn">Transcript and recording</Link>
        <Link href={LIBRARY_HREF} className="btn btn-quiet">All conversations</Link>
      </div>
    </div>
  );
}

function Unreachable({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="pt-16">
      <div role="alert" className="max-w-[60ch] border-l-[3px] border-vermilion pl-5">
        <div className="caps !text-vermilion">Backend</div>
        <p className="serif mt-1 text-[clamp(32px,4vw,48px)] leading-[1.02]">The debrief could not be fetched.</p>
        <p className="mt-3 text-[13.5px] text-ink-2">{message.replace(/\.$/, '')}. Check that the laptop backend is running, then try again.</p>
        <button type="button" className="btn btn-solid mt-5" onClick={onRetry}>Try again</button>
      </div>
    </div>
  );
}

function DebriefView({ sessionId, d, audio, turns, marks }: { sessionId: string; d: Debrief; audio: string | null; turns: TurnView[]; marks: Mark[] }) {
  const n: Partial<Debrief['numbers']> = d.numbers ?? {};
  const bookmarks = d.bookmarks ?? [];
  const notes = d.notes ?? [];
  return (
    <article className="pt-8">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="caps flex items-center gap-3">Debrief</div>
        <Link href={conversationHref(sessionId)} className="btn btn-sm">Transcript and recording</Link>
      </div>
      <div className="grid gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div>
          <h1 className="serif max-w-[22ch] text-[clamp(38px,4.6vw,72px)] leading-[0.98]">{d.headline_fact}</h1>
          <section className="mt-10 grid grid-cols-[110px_1fr] gap-x-6 border-t border-rule pt-4">
            <div className="caps pt-1">What worked</div>
            <p className="max-w-[58ch] text-[17px] leading-snug">{d.strength}</p>
          </section>
          <section className="mt-8 border-t-[3px] border-ink pt-4">
            <div className="grid grid-cols-[110px_1fr] gap-x-6">
              <div className="caps pt-1 !text-ink">One thing to fix</div>
              <p className="max-w-[52ch] text-[21px] leading-snug">{d.one_fix}</p>
            </div>
            <blockquote className="serif mt-7 border-l-[3px] border-ink pl-6 text-[clamp(30px,3.4vw,52px)] italic leading-[1.02]">{d.if_then}</blockquote>
            <div className="caps mt-2 pl-6">Your plan for next time. Say it once out loud.</div>
          </section>
        </div>
        <aside>
          <Player audio={audio} text={[d.headline_fact, d.strength, d.one_fix, d.if_then].filter(Boolean).join(' ')} />
          <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-6 border-t border-ink pt-4">
            <Num label="Talk ratio" value={fmt(n.talk_ratio, (v) => `${Math.round(v * 100)}%`)} wide />
            <Num label="Interruptions" value={fmt(n.interruptions, (v) => String(Math.round(v)))} />
            <Num label="Questions asked" value={fmt(n.questions, (v) => String(Math.round(v)))} />
            <Num label="Fillers / min" value={fmt(n.fillers_per_min, (v) => v.toFixed(1))} />
            <Num label="Pace, wpm" value={fmt(n.wpm, (v) => String(Math.round(v)))} />
          </dl>
          {d.vs_last_time && <p className="mt-5 border-t border-rule pt-3 text-[13px] text-ink-2"><span className="caps mr-2">Against your last time</span>{d.vs_last_time}</p>}
          {d.best_moment_quote && (
            <figure className="mt-8 border-t border-rule pt-4">
              <div className="caps mb-2">Best moment</div>
              <blockquote className="serif text-[30px] leading-[1.05]">“{d.best_moment_quote}”</blockquote>
            </figure>
          )}
        </aside>
      </div>

      <VoiceBody points={d.timeline ?? []} marks={marks} bookmarks={bookmarks.map((b) => b.ts)} />

      <div className="mt-14 grid gap-x-16 gap-y-10 lg:grid-cols-2">
        <section>
          <h2 className="caps border-b border-ink pb-2 !text-ink">Bookmarks · {bookmarks.length}</h2>
          {bookmarks.length === 0 && <p className="pt-3 text-ink-3">No bookmarks in this conversation.</p>}
          {bookmarks.map((b, i) => (
            <div key={i} className="grid grid-cols-[64px_1fr] gap-x-4 border-b border-rule py-4">
              <div><div className="num text-[15px]">{clock(b.ts)}</div><div className={`caps mt-1 ${b.source === 'promise' ? '!text-green' : ''}`}>{b.source === 'promise' ? 'promise heard' : 'you tapped'}</div></div>
              <div>
                <p className="serif text-[21px] leading-tight">“{b.snippet}”</p>
                <p className="mt-2 text-[13px] text-ink-2">{b.what_happened}</p>
                {b.follow_up && <p className="mt-2 text-[13px]"><span className="caps mr-2 !text-green">Follow up</span>{b.follow_up}</p>}
              </div>
            </div>
          ))}
        </section>
        <section>
          {d.better_version && (
            <>
              <h2 className="caps border-b border-ink pb-2 !text-ink">Hear the better version</h2>
              <div className="grid grid-cols-2 gap-x-6 py-4">
                <div><div className="caps mb-1">You said</div><p className="text-[13.5px] text-ink-2">{d.better_version.original}</p></div>
                <div><div className="caps mb-1 !text-ink">Shorter, answer first</div><p className="text-[15px]">{d.better_version.rewritten}</p>
                  <div className="mt-3"><Player audio={mediaUrl(d.better_version.audio_url)} text={d.better_version.rewritten} compact /></div></div>
              </div>
            </>
          )}
          <h2 className="caps mt-4 border-b border-ink pb-2 !text-ink">Notes</h2>
          <ul className="py-3">{notes.map((note, i) => <li key={i} className="grid grid-cols-[20px_1fr] py-1 text-[13.5px]"><span className="num text-ink-3">{i + 1}</span>{note}</li>)}</ul>
          <details className="border-t border-rule pt-3">
            <summary className="caps cursor-pointer hover:text-ink">Full transcript · {turns.length ? `${turns.length} turns` : 'not loaded'}</summary>
            <div className="mt-3 space-y-2">
              {turns.length === 0 && <p className="text-[13px] text-ink-3">The transcript is shown here right after a session on this screen.</p>}
              {turns.map((t) => <p key={t.turn_id} className={`text-[13.5px] ${t.speaker === 'me' ? '' : 'pl-8 text-ink-2'}`}><span className="num mr-2 text-[11px] text-ink-3">{clock(t.start)}</span>{t.text}</p>)}
            </div>
          </details>
        </section>
      </div>
    </article>
  );
}

/** A number for the panel, or a dash when the backend did not send one. */
function fmt(v: number | null | undefined, f: (v: number) => string): string {
  return typeof v === 'number' && Number.isFinite(v) ? f(v) : '—';
}

function Num({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return <div className={wide ? 'col-span-2' : ''}><dd className={`num leading-[0.85] ${wide ? 'text-[92px]' : 'text-[46px]'}`}>{value}</dd><dt className="caps mt-2">{label}</dt></div>;
}

/** The 20-second spoken recap. Plays the backend's MP3; without one it reads the text with the browser's voice. */
function Player({ audio, text, compact }: { audio: string | null; text: string; compact?: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const toggle = () => {
    if (audio && ref.current) {
      if (playing) ref.current.pause(); else void ref.current.play();
      return;
    }
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    if (playing) { window.speechSynthesis.cancel(); setPlaying(false); return; }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.onend = () => { setPlaying(false); setProgress(0); };
    u.onboundary = (e) => setProgress(Math.min(1, e.charIndex / Math.max(1, text.length)));
    setPlaying(true);
    window.speechSynthesis.speak(u);
  };
  return (
    <div className={`flex items-center gap-4 ${compact ? '' : 'border border-ink p-4'}`}>
      {audio && <audio ref={ref} src={audio} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setProgress(0); }}
        onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)} />}
      <button onClick={toggle} aria-label={playing ? 'Pause the spoken recap' : 'Play the spoken recap'}
        className={`flex shrink-0 items-center justify-center rounded-full bg-ink text-paper transition-transform hover:scale-105 active:scale-95 ${compact ? 'h-9 w-9' : 'h-14 w-14'}`}>
        {playing
          ? <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" width="3.5" height="14" fill="currentColor" /><rect x="8.5" width="3.5" height="14" fill="currentColor" /></svg>
          : <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 0l12 7-12 7z" fill="currentColor" /></svg>}
      </button>
      <div className="min-w-0 flex-1">
        {!compact && <div className="serif text-[22px] leading-none">Spoken recap</div>}
        <div className="relative mt-2 h-px bg-rule"><div className="absolute inset-y-[-1px] left-0 w-full origin-left bg-ink" style={{ transform: `scaleX(${progress})` }} /></div>
        {!compact && <div className="caps mt-2">{audio ? 'About 20 seconds' : 'No recording yet · read by this browser’s voice'}</div>}
      </div>
    </div>
  );
}

/** Pace, volume and hand energy on one time axis: three small multiples, drawn by hand. */
function VoiceBody({ points, marks, bookmarks }: { points: TimelinePoint[]; marks: Mark[]; bookmarks: number[] }) {
  if (points.length < 2) return null;
  const W = 1200, H = 62, LEFT = 0;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const x = (t: number) => LEFT + ((t - t0) / (t1 - t0 || 1)) * (W - LEFT);
  const rows: { key: keyof TimelinePoint; label: string; min: number; max: number; unit: string; band?: [number, number]; fmt: (v: number) => string }[] = [
    { key: 'wpm', label: 'Pace', min: 100, max: 230, unit: 'wpm', band: [120, 200], fmt: (v) => String(Math.round(v)) },
    { key: 'volume_db', label: 'Volume', min: -34, max: -8, unit: 'dBFS', fmt: (v) => String(Math.round(v)) },
    { key: 'hand_energy', label: 'Hand energy', min: 0, max: 1, unit: '0 to 1', band: [0.3, 0.7], fmt: (v) => v.toFixed(2) },
  ];
  const events = [
    ...marks.filter((m) => m.kind === 'nudge' || m.kind === 'signal').map((m) => ({ t: m.ts, label: m.kind === 'nudge' ? m.title : m.title.toLowerCase(), color: m.kind === 'nudge' ? 'var(--blue)' : 'var(--ink)' })),
    ...bookmarks.map((t) => ({ t, label: 'bookmark', color: 'var(--ink-2)' })),
  ].filter((e) => e.t >= t0 && e.t <= t1).sort((a, b) => a.t - b.t);
  const ticks: number[] = [];
  const step = t1 - t0 > 600 ? 120 : t1 - t0 > 150 ? 30 : 10;
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) ticks.push(t);
  return (
    <section className="mt-16" aria-label="Voice and body timeline">
      <h2 className="caps border-b border-ink pb-2 !text-ink">Voice and body, across the conversation</h2>
      <div className="mt-5 grid grid-cols-[110px_minmax(0,1fr)] gap-x-6">
        {rows.map((r, ri) => {
          const vals = points.filter((p) => r.key !== 'wpm' || p.wpm > 0);
          const y = (v: number) => H - 6 - ((Math.min(r.max, Math.max(r.min, v)) - r.min) / (r.max - r.min)) * (H - 12);
          const peak = vals.reduce((a, b) => ((b[r.key] as number) > (a[r.key] as number) ? b : a), vals[0]);
          return (
            <div key={r.key} className="contents">
              <div className="border-b border-rule py-3"><div className="text-[14px]">{r.label}</div><div className="caps">{r.unit}</div></div>
              <div className="border-b border-rule py-3">
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[62px] w-full" style={{ overflow: 'visible' }}>
                  {r.band && <rect x={0} width={W} y={y(r.band[1])} height={y(r.band[0]) - y(r.band[1])} fill="var(--well)" />}
                  {events.map((e, i) => <line key={i} x1={x(e.t)} x2={x(e.t)} y1={0} y2={H} stroke={e.color} strokeWidth={1} strokeDasharray={e.label === 'bookmark' ? '2 3' : undefined} vectorEffect="non-scaling-stroke" />)}
                  <polyline points={vals.map((p) => `${x(p.t).toFixed(1)},${y(p[r.key] as number).toFixed(1)}`).join(' ')} fill="none" stroke="var(--ink)" strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                  {peak && <circle cx={x(peak.t)} cy={y(peak[r.key] as number)} r={3} fill="var(--ink)" />}
                </svg>
                <div className="relative h-4">
                  {peak && <span className="num absolute -translate-x-1/2 text-[10.5px] tracking-normal" style={{ left: `${(x(peak.t) / W) * 100}%` }}>peak {r.fmt(peak[r.key] as number)}</span>}
                  {ri === 0 && events.map((e, i) => <span key={i} className="caps absolute -translate-x-1/2 whitespace-nowrap bg-paper px-1" style={{ top: i % 2 ? -98 : -84, left: `${(x(e.t) / W) * 100}%`, color: e.color }}>{e.label}</span>)}
                </div>
              </div>
            </div>
          );
        })}
        <div />
        <div className="relative h-5">
          {ticks.map((t) => <span key={t} className="num absolute top-1 -translate-x-1/2 text-[10.5px] tracking-normal text-ink-3" style={{ left: `${(x(t) / W) * 100}%` }}>{clock(t)}</span>)}
        </div>
      </div>
      <p className="mt-1 text-[12px] text-ink-3">Shaded bands are your own usual range. Vertical lines mark the nudge, signals and bookmarks.</p>
    </section>
  );
}
