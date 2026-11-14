'use client';

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Glyph } from '@/components/glyph';
import { LINES_PER_PAGE, cite, layout, lineAt } from '@/components/lines';
import { conversationHref, LIBRARY_HREF } from '@/lib/conversations/links';
import { clock } from '@/components/shell';
import { Spark } from '@/components/spark';
import { findConversation, getDebrief, listSessions, mediaUrl, type DebriefPayload } from '@/lib/api/client';
import type { CoachSpec, Debrief, TimelinePoint } from '@/lib/bus/contracts';
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

  const coach = state.coach;
  const baseline = state.metrics?.baseline_wpm ?? null;
  if (live) {
    // The transcript and marks on the bus belong to this debrief only if no newer session replaced them.
    const own = state.session?.id === live.session_id;
    return <DebriefView sessionId={live.session_id} d={live.data} audio={mediaUrl(live.audio_url)} turns={own ? state.turns : []} marks={own ? state.marks : []} coach={coach} baseline={baseline} />;
  }
  if (load.state === 'ok') return <DebriefView sessionId={load.payload.session_id} d={load.payload.data} audio={mediaUrl(load.payload.audio_url)} turns={[]} marks={[]} coach={coach} baseline={baseline} />;
  if (waiting && load.state === 'none') return <Waiting running={pendingSession?.endedAt === null} />;
  if (load.state === 'loading') return <p className="display-m caret pt-16 text-ink-3">Fetching the debrief</p>;
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
      <span className="label">Debrief</span>
      <p className={`display-l mt-2 text-ink-3 ${running ? '' : 'caret'}`}>{running ? 'A conversation is going on.' : 'Writing the debrief'}</p>
      <p className="text-m mt-4 max-w-[52ch] text-ink-2">{running ? 'The debrief lands here a few seconds after it ends.' : 'It usually takes a few seconds after a conversation ends.'}</p>
    </div>
  );
}

function NoDebrief({ sessionId, reason }: { sessionId: string | null; reason: string | null }) {
  if (!sessionId) {
    return (
      <div className="pt-16">
        <span className="label">Debrief</span>
        <p className="display-l mt-2 max-w-[22ch]">No debriefs yet.</p>
        <p className="text-m mt-4 max-w-[52ch] text-ink-2">Wear the band and talk. When a conversation ends, its debrief shows up here on its own.</p>
      </div>
    );
  }
  return (
    <div className="pt-16">
      <span className="label">Debrief</span>
      <p className="display-l mt-2 max-w-[22ch]">No debrief for this one.</p>
      <p className="text-m mt-4 max-w-[52ch] text-ink-2">
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
      <div role="alert" className="max-w-[60ch] border-l-[3px] border-ink pl-5">
        <span className="label !text-ink">Backend</span>
        <p className="display-m mt-1">The debrief could not be fetched.</p>
        <p className="text-m mt-3 text-ink-2">{message.replace(/\.$/, '')}. Check that the laptop backend is running, then try again.</p>
        <button type="button" className="btn btn-solid mt-5" onClick={onRetry}>Try again</button>
      </div>
    </div>
  );
}

/** The coach's talk-share target, read from a rule like "metrics.talk_ratio > 0.4". */
function talkTarget(coach: CoachSpec | null): number | null {
  const rule = coach?.nudge_rules?.find((r) => r.when.includes('metrics.talk_ratio'));
  const n = rule ? Number(rule.when.split(/[<>=]+/).pop()) : NaN;
  return Number.isFinite(n) && n > 0 && n < 1 ? n : null;
}

function DebriefView({ sessionId, d, audio, turns, marks, coach, baseline }: {
  sessionId: string; d: Debrief; audio: string | null; turns: TurnView[]; marks: Mark[]; coach: CoachSpec | null; baseline: number | null;
}) {
  const n: Partial<Debrief['numbers']> = d.numbers ?? {};
  const bookmarks = d.bookmarks ?? [];
  const notes = d.notes ?? [];
  const timeline = d.timeline ?? [];
  const { lines, first } = useMemo(() => layout(turns), [turns]);
  const transcriptRef = useRef<HTMLDetailsElement>(null);
  const citeAt = (ts: number) => { const ln = lineAt(turns, first, ts); return ln !== null ? { n: ln, label: cite(ln) } : null; };
  const goTo = (ln: number) => {
    const det = transcriptRef.current;
    if (det) det.open = true;
    setTimeout(() => document.getElementById(`line-${ln}`)?.scrollIntoView({ block: 'center' }), 80);
  };
  const target = talkTarget(coach);
  const pace = timeline.filter((p) => p.wpm > 0).map((p) => p.wpm);

  return (
    <article className="pt-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3"><span className="label">Debrief</span></div>
        <Link href={conversationHref(sessionId)} className="link text-s">Transcript and recording</Link>
      </div>
      <div className="grid gap-x-6 gap-y-12 xl:grid-cols-12">
        <div className="xl:col-span-8">
          <h1 className="display-l max-w-[22ch]">{d.headline_fact}</h1>

          <section className="mt-12 grid gap-x-6 gap-y-2 md:grid-cols-[120px_minmax(0,1fr)]">
            <h2 className="label pt-1">What worked</h2>
            <p className="text-l max-w-[58ch]">{d.strength}</p>
          </section>

          <section className="mt-10 border-t-2 border-ink pt-5">
            <div className="grid gap-x-6 gap-y-2 md:grid-cols-[120px_minmax(0,1fr)]">
              <h2 className="label pt-1 !text-ink">One thing to fix</h2>
              <p className="text-l max-w-[56ch]">{d.one_fix}</p>
            </div>
            <blockquote className="display-m mt-8 max-w-[26ch] -indent-[0.4em] italic leading-[1.1] md:ml-[144px] md:text-[clamp(32px,3.2vw,46px)]">“{d.if_then}”</blockquote>
            <p className="text-s mt-3 text-ink-2 md:ml-[144px]">Your plan for next time. Say it once out loud.</p>
          </section>
        </div>

        <aside className="xl:col-span-4">
          <Player audio={audio} text={[d.headline_fact, d.strength, d.one_fix, d.if_then].filter(Boolean).join(' ')} />
          <dl className="mt-8 border-t border-ink">
            <Num value={fmt(n.talk_ratio, (v) => `${Math.round(v * 100)}`)} unit={known(n.talk_ratio) ? '%' : undefined} label={<>of the talking was you{target !== null && <>, target <span className="num-s text-ink">{Math.round(target * 100)}%</span></>}</>} />
            <Num value={fmt(n.wpm, (v) => String(Math.round(v)))} unit={known(n.wpm) ? 'wpm' : undefined} label={<>
              <span className="inline-flex items-center gap-2">your pace{baseline !== null && <>, usual <span className="num-s text-ink">{Math.round(baseline)}</span></>}
                {pace.length > 1 && <Spark values={pace} width={64} height={14} min={100} max={230} band={baseline !== null ? [baseline * 0.75, baseline * 1.25] : [120, 200]} />}</span>
            </>} />
            <Num value={fmt(n.fillers_per_min, (v) => v.toFixed(1))} label="fillers a minute" />
            <Num value={fmt(n.questions, (v) => String(Math.round(v)))} label={n.questions === 1 ? 'question asked' : 'questions asked'} />
            <Num value={fmt(n.interruptions, (v) => String(Math.round(v)))} label={n.interruptions === 1 ? 'interruption' : 'interruptions'} />
          </dl>
          {d.vs_last_time && (
            <p className="text-s mt-4 text-ink-2"><span className="label mr-2">Against your last time</span>{d.vs_last_time}</p>
          )}
          {d.best_moment_quote && (
            <figure className="mt-10 border-t border-rule pt-4">
              <figcaption className="label mb-2">Best moment</figcaption>
              <blockquote className="display-s -indent-[0.35em]">“{d.best_moment_quote}”</blockquote>
            </figure>
          )}
        </aside>
      </div>

      <VoiceBody points={timeline} marks={marks} bookmarks={bookmarks.map((b) => ({ t: b.ts, cite: citeAt(b.ts)?.label ?? null }))} />

      <div className="mt-16 grid gap-x-6 gap-y-12 xl:grid-cols-12">
        <section className="xl:col-span-6">
          <h2 className="display-s border-b border-ink pb-2">Bookmarks <span className="num-s ml-1 text-ink-3">{bookmarks.length}</span></h2>
          {bookmarks.length === 0 && <p className="text-m pt-3 text-ink-3">No bookmarks in this conversation.</p>}
          {bookmarks.map((b, i) => {
            const c = citeAt(b.ts);
            return (
              <div key={i} className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-6 border-b border-rule py-5">
                <div>
                  {c ? <button className="num-m link" onClick={() => goTo(c.n)} title="Show this line in the transcript">{c.label}</button> : <span className="num-m">{clock(b.ts)}</span>}
                  {c && <div className="num-s text-ink-3">{clock(b.ts)}</div>}
                  <div className="label mt-1">{b.source === 'promise' ? 'Promise heard' : 'You tapped'}</div>
                </div>
                <div>
                  <p className="display-s -indent-[0.35em]">“{b.snippet}”</p>
                  <p className="text-m mt-2 text-ink-2">{b.what_happened}</p>
                  {b.follow_up && <p className="text-m mt-2"><span className="label mr-2">Follow up</span>{b.follow_up}</p>}
                </div>
              </div>
            );
          })}
        </section>
        <section className="xl:col-span-6">
          {d.better_version && (
            <>
              <h2 className="display-s border-b border-ink pb-2">Hear the better version</h2>
              <div className="grid gap-x-6 gap-y-5 py-5 md:grid-cols-2">
                <div><div className="label mb-1">You said</div><p className="text-m text-ink-2">{d.better_version.original}</p></div>
                <div><div className="label mb-1 !text-ink">Shorter, answer first</div><p className="text-m">{d.better_version.rewritten}</p>
                  <div className="mt-4"><Player audio={mediaUrl(d.better_version.audio_url)} text={d.better_version.rewritten} compact /></div></div>
              </div>
            </>
          )}
          <h2 className="display-s mt-6 border-b border-ink pb-2">Notes</h2>
          <ol className="py-3">{notes.map((note, i) => <li key={i} className="text-m grid grid-cols-[28px_1fr] py-1.5"><span className="num-s pt-[3px] text-ink-3">{i + 1}</span>{note}</li>)}</ol>
          <details ref={transcriptRef} className="group border-t border-rule pt-4">
            <summary className="text-m cursor-pointer list-none text-ink-2 hover:text-ink">
              <span className="mr-2 inline-block transition-transform group-open:rotate-90">›</span>Full transcript <span className="num-s text-ink-3">{turns.length ? `${turns.length} turns, ${lines.length} lines` : 'not loaded'}</span>
            </summary>
            {turns.length === 0 && <p className="text-s mt-3 text-ink-3">The transcript is shown here right after a session on this screen.</p>}
          </details>
        </section>
      </div>

      {turns.length > 0 && <Transcript turns={turns} open={transcriptRef} />}
    </article>
  );
}

/** A number for the panel, or a dash when the backend did not send one. */
function known(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function fmt(v: number | null | undefined, f: (v: number) => string): string {
  return known(v) ? f(v) : '—';
}

/** Court-record transcript: 25 numbered lines a page, numbers in the score margin. Shown when the summary above is opened. */
function Transcript({ turns, open }: { turns: TurnView[]; open: RefObject<HTMLDetailsElement | null> }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const det = open.current;
    if (!det) return;
    const on = () => setShown(det.open);
    det.addEventListener('toggle', on);
    return () => det.removeEventListener('toggle', on);
  }, [open]);
  const { lines } = useMemo(() => layout(turns), [turns]);
  return (
    <section aria-label="Full transcript" hidden={!shown} className="mt-6 xl:max-w-[calc(100%*7/12)]">
      {lines.map((l, i) => {
        const t = turns[l.turn];
        const firstOfTurn = i === 0 || lines[i - 1].turn !== l.turn;
        const me = t.speaker === 'me';
        return (
          <Fragment key={l.n}>
            {l.line === 1 && <div className="num-s mb-2 mt-6 text-ink-3 first:mt-0">p. {l.page}</div>}
            <div id={`line-${l.n}`} className="relative grid scroll-mt-24 grid-cols-[72px_minmax(0,1fr)] gap-x-6 md:grid-cols-[96px_minmax(0,1fr)]">
              <span className="num-s absolute right-full mr-4 w-8 pt-[5px] text-right text-ink-3">{l.line}</span>
              <span className={`label pt-[3px] ${me ? '!text-ink' : ''}`}>{firstOfTurn ? <>{me ? 'you' : 'them'} <span className="num-s ml-1 text-ink-3">{clock(t.start)}</span></> : ''}</span>
              <span className={`text-l ${me ? '' : 'pl-8 text-ink-2'}`}>{l.text}</span>
            </div>
          </Fragment>
        );
      })}
      <p className="text-s mt-3 text-ink-3">{LINES_PER_PAGE} lines a page. Bookmarks above are cited page:line.</p>
    </section>
  );
}

function Num({ value, unit, label }: { value: string; unit?: string; label: ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-4 border-b border-rule py-3">
      <dd className="num-l w-[4.6ch] whitespace-nowrap">{value}{unit && <span className="unit">{unit}</span>}</dd>
      <dt className="text-s text-ink-2">{label}</dt>
    </div>
  );
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
    <div className={`flex items-center gap-4 ${compact ? '' : 'border-y border-rule py-4'}`}>
      {audio && <audio ref={ref} src={audio} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setProgress(0); }}
        onTimeUpdate={(e) => setProgress(e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0)} />}
      <button onClick={toggle} aria-label={playing ? 'Pause the spoken recap' : 'Play the spoken recap'}
        className={`flex shrink-0 items-center justify-center rounded-[var(--r-key)] bg-ink text-paper transition-transform active:translate-y-px ${compact ? 'h-9 w-9' : 'h-12 w-12'}`}>
        {playing
          ? <svg width="14" height="14" viewBox="0 0 14 14"><rect x="2" width="3.5" height="14" fill="currentColor" /><rect x="8.5" width="3.5" height="14" fill="currentColor" /></svg>
          : <svg width="14" height="14" viewBox="0 0 14 14"><path d="M2 0l12 7-12 7z" fill="currentColor" /></svg>}
      </button>
      <div className="min-w-0 flex-1">
        {!compact && <div className="display-s leading-none">Spoken recap</div>}
        <div className="relative mt-2 h-px bg-rule-strong"><div className="absolute inset-y-[-1px] left-0 w-full origin-left bg-ink" style={{ transform: `scaleX(${progress})` }} /></div>
        {!compact && <div className="text-s mt-2 text-ink-2">{audio ? 'About 20 seconds' : 'No recording yet. Read by this browser’s voice.'}</div>}
      </div>
    </div>
  );
}

/** Pace, volume and hand energy on one time axis: three small multiples, drawn by hand. */
function VoiceBody({ points, marks, bookmarks }: { points: TimelinePoint[]; marks: Mark[]; bookmarks: { t: number; cite: string | null }[] }) {
  if (points.length < 2) return null;
  const W = 1200, H = 62;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const x = (t: number) => ((t - t0) / (t1 - t0 || 1)) * W;
  const pct = (t: number) => `${(x(t) / W) * 100}%`;
  const rows: { key: keyof TimelinePoint; label: string; min: number; max: number; unit: string; band?: [number, number]; fmt: (v: number) => string }[] = [
    { key: 'wpm', label: 'Pace', min: 100, max: 230, unit: 'wpm', band: [120, 200], fmt: (v) => String(Math.round(v)) },
    { key: 'volume_db', label: 'Volume', min: -34, max: -8, unit: 'dBFS', fmt: (v) => String(Math.round(v)) },
    { key: 'hand_energy', label: 'Hand energy', min: 0, max: 1, unit: '0 to 1', band: [0.3, 0.7], fmt: (v) => v.toFixed(2) },
  ];
  const inRange = (t: number) => t >= t0 && t <= t1;
  const nudges = marks.filter((m) => m.kind === 'nudge' && m.pattern && inRange(m.ts));
  const signals = marks.filter((m) => m.kind === 'signal' && inRange(m.ts));
  const books = bookmarks.filter((b) => inRange(b.t));
  const ticks: number[] = [];
  const step = t1 - t0 > 600 ? 120 : t1 - t0 > 150 ? 30 : 10;
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) ticks.push(t);
  return (
    <section className="mt-20" aria-label="Voice and body timeline">
      <h2 className="display-s border-b border-ink pb-2">Voice and body, across the conversation</h2>
      <div className="mt-3 grid grid-cols-[96px_minmax(0,1fr)] gap-x-6 md:grid-cols-[120px_minmax(0,1fr)]">
        <div />
        <div className="relative h-7">
          {nudges.map((m) => <span key={m.id} className="absolute top-1 -translate-x-1/2" style={{ left: pct(m.ts) }} title={`${m.title}: ${m.detail}`}><Glyph pattern={m.pattern!} size={18} /></span>)}
          {signals.map((m) => <span key={m.id} className="absolute top-2 flex -translate-x-1/2 items-center gap-1.5" style={{ left: pct(m.ts) }} title={m.detail}>
            <span className="inline-block h-[8px] w-[8px] rotate-45 border border-ink-2" /><span className="text-s text-ink-2">{m.title.toLowerCase()}</span></span>)}
          {books.map((b, i) => <span key={i} className="num-s absolute top-1.5 -translate-x-1/2 bg-paper px-1 text-ink" style={{ left: pct(b.t) }}>{b.cite ?? clock(b.t)}</span>)}
        </div>
        {rows.map((r) => {
          const vals = points.filter((p) => r.key !== 'wpm' || p.wpm > 0);
          const y = (v: number) => H - 6 - ((Math.min(r.max, Math.max(r.min, v)) - r.min) / (r.max - r.min)) * (H - 12);
          const peak = vals.reduce((a, b) => ((b[r.key] as number) > (a[r.key] as number) ? b : a), vals[0]);
          return (
            <div key={r.key} className="contents">
              <div className="border-b border-rule py-3"><div className="text-m">{r.label}</div><div className="num-s text-ink-3">{r.unit}</div></div>
              <div className="border-b border-rule py-3">
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[62px] w-full" style={{ overflow: 'visible' }} aria-hidden>
                  {r.band && <rect x={0} width={W} y={y(r.band[1])} height={y(r.band[0]) - y(r.band[1])} fill="var(--well)" />}
                  {nudges.map((m) => <line key={m.id} x1={x(m.ts)} x2={x(m.ts)} y1={0} y2={H} stroke="var(--ink-3)" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
                  {signals.map((m) => <line key={m.id} x1={x(m.ts)} x2={x(m.ts)} y1={0} y2={H} stroke="var(--ink-2)" strokeWidth={1} strokeDasharray="1 3" vectorEffect="non-scaling-stroke" />)}
                  {books.map((b, i) => <line key={i} x1={x(b.t)} x2={x(b.t)} y1={0} y2={H} stroke="var(--ink-2)" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />)}
                  <polyline points={vals.map((p) => `${x(p.t).toFixed(1)},${y(p[r.key] as number).toFixed(1)}`).join(' ')} fill="none" stroke="var(--ink)" strokeWidth={1.75} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                </svg>
                <div className="relative h-4">
                  {peak && <span className="num-s absolute -translate-x-1/2 text-ink-2" style={{ left: pct(peak.t) }}>peak {r.fmt(peak[r.key] as number)}</span>}
                </div>
              </div>
            </div>
          );
        })}
        <div />
        <div className="relative h-5">
          {ticks.map((t) => <span key={t} className="num-s absolute top-1 -translate-x-1/2 text-ink-3" style={{ left: pct(t) }}>{clock(t)}</span>)}
        </div>
      </div>
      <p className="text-s mt-3 text-ink-3">Shaded bands are your own usual range. Vertical lines mark the nudge, signals and bookmarks.</p>
    </section>
  );
}
