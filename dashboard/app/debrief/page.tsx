'use client';

import { useEffect, useRef, useState } from 'react';
import { clock } from '@/components/shell';
import { SampleTag } from '@/components/sample-tag';
import { getDebrief, listSessions, mediaUrl, type DebriefPayload, type Sampled } from '@/lib/api/client';
import type { Debrief, TimelinePoint } from '@/lib/bus/contracts';
import type { Mark, TurnView } from '@/lib/bus/reducer';
import { useBus } from '@/lib/bus/use-bus';

export default function DebriefPage() {
  const { state } = useBus();
  const [fallback, setFallback] = useState<Sampled<DebriefPayload> | null>(null);
  // ?session=<id> (linked from the graph) asks for one stored conversation, not the latest.
  const [requested] = useState<string | null>(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('session')));
  const live = state.debrief && (!requested || state.debrief.session_id === requested) ? state.debrief : null;
  useEffect(() => {
    if (live) return;
    let on = true;
    // No matching debrief on the bus: show the requested stored one, else the most recent, or the sample.
    const pick = requested
      ? getDebrief(requested)
      : listSessions().then((s) => getDebrief(s.sample ? 'latest' : s.data[0].session_id));
    pick.then((r) => on && setFallback(r));
    return () => { on = false; };
  }, [live, requested]);
  const payload = live ?? fallback?.data ?? null;
  if (!payload) return <p className="serif pt-16 text-[32px] text-ink-3">Fetching the debrief…</p>;
  // The transcript and marks on the bus belong to this debrief only if no newer session replaced them.
  const own = live !== null && state.session?.id === live.session_id;
  return <DebriefView d={payload.data} audio={mediaUrl(payload.audio_url)} sample={live ? state.status === 'mock' : fallback?.sample ?? true}
    turns={own ? state.turns : []} marks={own ? state.marks : []} />;
}

function DebriefView({ d, audio, sample, turns, marks }: { d: Debrief; audio: string | null; sample: boolean; turns: TurnView[]; marks: Mark[] }) {
  const n = d.numbers;
  return (
    <article className="pt-8">
      <div className="caps mb-5 flex items-center gap-3">Debrief <SampleTag show={sample} /></div>
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
          <Player audio={audio} text={[d.headline_fact, d.strength, d.one_fix, d.if_then].join(' ')} />
          <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-6 border-t border-ink pt-4">
            <Num label="Talk ratio" value={`${Math.round(n.talk_ratio * 100)}%`} wide />
            <Num label="Interruptions" value={String(n.interruptions)} />
            <Num label="Questions asked" value={String(n.questions)} />
            <Num label="Fillers / min" value={n.fillers_per_min.toFixed(1)} />
            <Num label="Pace, wpm" value={String(Math.round(n.wpm))} />
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

      <VoiceBody points={d.timeline} marks={marks} bookmarks={d.bookmarks.map((b) => b.ts)} />

      <div className="mt-14 grid gap-x-16 gap-y-10 lg:grid-cols-2">
        <section>
          <h2 className="caps border-b border-ink pb-2 !text-ink">Bookmarks · {d.bookmarks.length}</h2>
          {d.bookmarks.length === 0 && <p className="pt-3 text-ink-3">No bookmarks in this conversation.</p>}
          {d.bookmarks.map((b, i) => (
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
          <ul className="py-3">{d.notes.map((note, i) => <li key={i} className="grid grid-cols-[20px_1fr] py-1 text-[13.5px]"><span className="num text-ink-3">{i + 1}</span>{note}</li>)}</ul>
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
