'use client';

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Glyph } from '@/components/glyph';
import { cite, layout, lineAt, subtitle, type Line } from '@/components/lines';
import { EnergyStrip, PaceMeter, QuarterNote } from '@/components/live/meters';
import { TAKEOVER_MS, clock } from '@/components/shell';
import type { CoachSpec, JudgeAnswer, NudgeRule } from '@/lib/bus/contracts';
import { PATTERNS } from '@/lib/bus/patterns';
import { isLive, wordFromReason, type BusState, type Mark, type TurnView } from '@/lib/bus/reducer';
import { useBus, useNow } from '@/lib/bus/use-bus';

const MONOLOGUE_LIMIT = 45;
/** Seconds of conversation the score shows at once; the playhead stays near the right edge after that. */
const SCORE_WINDOW = 60;

/** The coach's talk-share target, read from a rule like "metrics.talk_ratio > 0.4". */
function talkTarget(coach: CoachSpec | null): number {
  const rule = coach?.nudge_rules.find((r) => r.when.includes('metrics.talk_ratio'));
  const n = rule ? Number(rule.when.split(/[<>=]+/).pop()) : NaN;
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.5;
}

/** The upper edge of the wearer's band. Slow speech is never flagged live. */
function upperEdge(state: BusState): number | null {
  const b = state.metrics?.baseline_wpm ?? null;
  return b !== null ? b * (1 + (state.session?.policy.tolerance || 0.25)) : null;
}

export function LiveScreen() {
  const { state } = useBus();
  const now = useNow(500);
  const session = state.session;
  if (!session || (!isLive(state) && state.turns.length === 0)) return <Idle state={state} />;
  const elapsed = ((session.endedAt ?? now) - session.startedAt) / 1000;
  const practice = session.mode === 'practice';
  return (
    <div className="pt-6">
      {session.endedAt !== null && (
        <div className="anim-rise mb-6 flex flex-wrap items-baseline justify-between gap-4 border-b border-rule pb-4">
          <span className="display-m">{practice ? 'Round finished.' : 'Conversation ended.'}</span>
          {!practice && (state.debrief
            ? <Link className="btn btn-solid" href="/debrief">Read the debrief</Link>
            : <span className="text-s caret text-ink-2">Writing the debrief</span>)}
        </div>
      )}
      {practice ? <PracticeLine state={state} /> : <TempoLine state={state} />}
      <Score state={state} elapsed={elapsed} practice={practice} />
      <div className="mt-8 grid gap-x-6 gap-y-10 xl:grid-cols-12">
        <div className="min-w-0 xl:col-span-9"><Script state={state} /></div>
        <div className="xl:col-span-3"><Rail state={state} practice={practice} /></div>
      </div>
    </div>
  );
}

// ---------- tempo line: marking, pace needle, hands ----------
function Budget({ total, left }: { total: number; left: number }) {
  return (
    <span className="tone-blue inline-flex items-center gap-1.5" role="img" aria-label={`${left} of ${total} buzzes left`}>
      {Array.from({ length: total }, (_, i) => {
        const spent = i >= left;
        return (
          <svg key={i} width="16" height="12" viewBox="0 0 16 12" aria-hidden>
            <ellipse cx="8" cy="6" rx={spent ? 5.6 : 6.2} ry={spent ? 3.8 : 4.4} transform="rotate(-20 8 6)"
              fill={spent ? 'none' : 'var(--tone)'} stroke={spent ? 'var(--ink-3)' : 'none'} strokeWidth={1.2} />
          </svg>
        );
      })}
    </span>
  );
}

function TempoLine({ state }: { state: BusState }) {
  const m = state.metrics;
  const policy = state.session?.policy;
  const baseline = m?.baseline_wpm ?? null;
  const tol = policy?.tolerance || 0.25;
  const upper = upperEdge(state);
  const fast = upper !== null && (m?.wpm ?? 0) > upper;
  const total = Math.min(policy?.budget_per_session ?? 3, 12);
  const left = Math.min(state.budgetLeft ?? total, total);
  const focus = state.coach?.nudge_rules.find((r) => r.id === policy?.focus_rule_id);
  return (
    <section aria-label="Tempo" className="grid gap-x-6 gap-y-8 border-b border-rule pb-6 md:grid-cols-8 xl:grid-cols-12">
      <div className="md:col-span-4 xl:col-span-4">
        <div className="display-xl flex items-end gap-3 whitespace-nowrap" aria-label={baseline !== null ? `Your tempo: ${Math.round(baseline)} words a minute` : 'Finding your tempo'}>
          <QuarterNote size={84} /><span className="pb-[0.04em]">= {baseline !== null ? Math.round(baseline) : '–'}</span>
        </div>
        <div className="mt-4 flex flex-wrap items-baseline gap-x-3">
          <span className="display-s italic">Regular</span>
          <span className="text-s text-ink-2">only taps when you rush</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <Budget total={total} left={left} />
          <span className="text-s text-ink-2">
            <span className="num-s text-ink">{left}</span> of {total} <span className="tone-blue" style={{ color: 'var(--tone-text)' }}>{(focus?.message ?? 'Slow down').toLowerCase()}</span> taps left, <span className="num-s">{policy?.min_gap_s ?? 120}</span> s apart
          </span>
        </div>
      </div>

      <div className="flex items-end gap-6 md:col-span-4 xl:col-span-5">
        <div className="w-[56%] max-w-[300px] shrink-0"><PaceMeter wpm={m ? m.wpm : null} baseline={baseline} tolerance={tol} fast={fast} /></div>
        <div className="min-w-0 pb-1">
          <div className={`num-xl max-md:text-[72px] ${fast ? 'text-blue-text' : ''}`}>{m ? Math.round(m.wpm) : '–'}</div>
          <div className="text-s mt-2 text-ink-2">wpm{fast && <span className="mono-italic ml-2 text-blue-text">rit.</span>}</div>
          <div className="text-s text-ink-2">{baseline !== null ? <>your usual <span className="num-s text-ink">{Math.round(baseline)}</span></> : 'finding your usual'}</div>
        </div>
      </div>

      <div className="md:col-span-8 xl:col-span-3"><Hands state={state} /></div>
    </section>
  );
}

function Hands({ state }: { state: BusState }) {
  const e = state.motion?.hand_energy ?? state.metrics?.hand_energy ?? 0;
  const motion = state.motion;
  const m = state.metrics;
  const word = e < 0.15 ? 'frozen' : e < 0.3 ? 'quiet' : e <= 0.7 ? 'natural' : e <= 0.85 ? 'busy' : 'overdoing it';
  const who = motion?.speaker_context === 'me' ? 'while you spoke' : motion?.speaker_context === 'other' ? 'while they spoke' : '';
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="display-s">Hands <span className="italic">{word}</span></span>
        <span className="num-s text-ink-2">{e.toFixed(2)}</span>
      </div>
      <div className="text-s text-ink-3">{motion ? `${motion.state} ${who}` : 'no motion yet'}</div>
      <div className="mt-2"><EnergyStrip value={e} /></div>
      <div className="mt-5 flex items-baseline justify-between gap-3">
        <span className="text-m flex gap-4" aria-label={`Volume: ${m?.volume_state ?? 'no reading'}`}>
          {(['quiet', 'ok', 'loud'] as const).map((v) => (
            <span key={v} className={m?.volume_state === v ? 'border-b-2 border-ink text-ink' : 'text-ink-3'}>{v === 'ok' ? 'your usual' : v}</span>
          ))}
        </span>
        <span className="num-s text-ink-3">{m ? `${m.volume_db.toFixed(0)} dBFS` : ''}</span>
      </div>
    </div>
  );
}

// ---------- practice: the drill stave ----------
function PracticeLine({ state }: { state: BusState }) {
  const p = state.practice;
  const coach = state.coach;
  const words = coach?.filler_words.length ? coach.filler_words : Object.keys(p.words);
  const prompt = coach?.drill.prompts[Math.floor((Math.max(1, p.round) - 1) / 2) % Math.max(1, coach?.drill.prompts.length ?? 1)] ?? 'Tell me about yourself.';
  const ended = state.session?.endedAt !== null;
  const caught = state.marks.filter((m) => m.kind === 'nudge' && (m.pattern === 'filler' || m.pattern === 'success'));
  const span = Math.max(15, ...caught.map((m) => m.ts + 1.5));
  return (
    <section aria-label="Practice drill" className="grid gap-x-6 gap-y-8 border-b border-rule pb-6 md:grid-cols-8 xl:grid-cols-12">
      <div className="md:col-span-8 xl:col-span-4">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <span className="display-m italic">Practice</span>
          <span className="text-s text-ink-2">round <span className="num-s text-ink">{Math.max(1, p.round)}</span>, strict on purpose</span>
        </div>
        <p className="display-s mt-4 italic">“{prompt}”</p>
        <p className="text-s mt-3 max-w-[40ch] text-ink-2">A drill, strict on purpose. Every one of your own crutch words gets a tap.</p>
      </div>

      <div className="md:col-span-5 xl:col-span-5" aria-label="Crutch words caught this round">
        <div className="relative h-[120px]">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="absolute inset-x-0 h-px bg-rule" style={{ top: 24 + i * 9 }} />)}
          <div className="absolute left-0 top-[24px] h-[37px] w-px bg-ink" />
          {caught.map((m) => {
            const word = m.pattern === 'filler' ? wordFromReason(m.detail) ?? '' : '';
            return (
              <div key={m.id} className="absolute top-[5px] flex -translate-x-1/2 flex-col items-center" style={{ left: `${Math.min(97, 3 + (m.ts / span) * 94)}%` }}>
                <Glyph pattern={m.pattern!} size={56} playing playKey={m.id} />
                <span className={`num-s mt-2 ${m.pattern === 'success' ? 'text-green-text' : 'text-ochre-text'}`}>{word || m.title.toLowerCase()}</span>
              </div>
            );
          })}
          {caught.length === 0 && <p className="text-s absolute bottom-0 left-0 text-ink-3">Each crutch word lands here as it is caught.</p>}
        </div>
      </div>

      <div className="md:col-span-3 xl:col-span-3">
        <div className="flex items-end gap-4">
          <span key={p.count} className="num-xl text-ochre-text" style={{ animation: 'strike 120ms var(--ease-enter) both' }}>{p.count}</span>
          {p.previous !== null && <span className="num-m pb-1 text-ink-3">{p.previous} → <span className="text-ink">{p.count}</span></span>}
        </div>
        <div className="text-s mt-2 text-ink-2">
          {ended ? 'round score' : 'caught this round'}. {p.previous !== null ? `Last round ${p.previous}.` : 'First round. This sets the number to beat.'}
        </div>
        <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
          {words.map((w) => (
            <span key={w} className="label">{w}{p.words[w] ? <span className="num-s ml-1 text-ochre-text">×{p.words[w]}</span> : null}</span>
          ))}
        </div>
        {p.success && <p className="text-s mt-3 flex items-center gap-2 text-green-text"><Glyph pattern="success" size={18} playing />A cleaner round than the last one.</p>}
      </div>
    </section>
  );
}

// ---------- the score: two staves and the percussion line ----------
function Score({ state, elapsed, practice }: { state: BusState; elapsed: number; practice: boolean }) {
  // session time can run ahead of the wall clock (fixture replay at speed), so measure both
  const latest = Math.max(elapsed, state.turns.at(-1)?.end ?? 0, state.marks.at(-1)?.ts ?? 0);
  const t0 = Math.max(0, latest - SCORE_WINDOW * 0.95);
  const pos = (t: number) => `${(t / SCORE_WINDOW) * 100}%`;
  const { first } = useMemo(() => layout(state.turns), [state.turns]);
  const bars: number[] = [];
  for (let t = 0; t <= latest + SCORE_WINDOW; t += 10) bars.push(t);
  const ratio = state.metrics?.talk_ratio ?? 0;
  const target = talkTarget(state.coach);

  const stave = (top: number) => [0, 1, 2, 3, 4].map((i) => <div key={i} className="absolute inset-x-0 h-px bg-rule" style={{ top: top + i * 5 }} />);

  return (
    <section aria-label="Score: who spoke when, and every pattern that fired" className="relative mt-6">
      <div className="label pointer-events-none absolute right-full top-[22px] mr-4 hidden text-right leading-[20px] md:block">you</div>
      <div className="label pointer-events-none absolute right-full top-[54px] mr-4 hidden text-right leading-[20px] md:block">them</div>
      <div className="relative h-[132px] overflow-hidden">
        {stave(22)}
        {stave(54)}
        <div className="absolute inset-x-0 top-[112px] h-px bg-ink" />
        <div className="absolute inset-0" style={{ transform: `translateX(-${(t0 / SCORE_WINDOW) * 100}%)`, transition: 'transform 500ms linear' }}>
          {bars.map((t) => (
            <Fragment key={t}>
              <div className="absolute top-[18px] h-[96px] w-px bg-rule" style={{ left: pos(t) }} />
              <span className="num-s absolute top-0 ml-1 text-ink-3" style={{ left: pos(t) }}>{clock(t)}</span>
            </Fragment>
          ))}
          {state.turns.map((t) => (
            <div key={t.turn_id} title={`${t.speaker === 'me' ? 'You' : 'Them'} ${clock(t.start)}`}
              className={`absolute h-[8px] ${t.speaker === 'me' ? 'top-[28px] bg-ink' : 'top-[60px] bg-them'}`}
              style={{ left: pos(t.start), width: `${Math.max(0.25, ((t.end - t.start) / SCORE_WINDOW) * 100)}%` }} />
          ))}
          {state.marks.map((m) => <ScoreMark key={m.id} mark={m} left={pos(m.ts)} cite={citeFor(state.turns, first, m.ts)} practice={practice} />)}
          <div className="absolute bottom-0 top-[18px] w-[2px] -translate-x-1/2 bg-ink" style={{ left: pos(latest) }} />
        </div>
      </div>
      {!practice && (
        <div className="mt-3 flex items-center gap-4">
          <span className="num-m w-[3.2ch]">{Math.round(ratio * 100)}%</span>
          <div className="relative h-1 flex-1 bg-them" role="img" aria-label={`You talked ${Math.round(ratio * 100)}% of the time; target ${Math.round(target * 100)}%`}>
            <div className="absolute inset-y-0 left-0 w-full origin-left bg-ink" style={{ transform: `scaleX(${ratio})`, transition: 'transform 600ms var(--ease-std)' }} />
            <div className="absolute -bottom-1.5 -top-1.5 w-px bg-ink" style={{ left: `${target * 100}%` }} />
          </div>
          <span className="text-s whitespace-nowrap text-ink-2">talk share, target <span className="num-s text-ink">{Math.round(target * 100)}%</span></span>
        </div>
      )}
    </section>
  );
}

function citeFor(turns: TurnView[], first: number[], ts: number): string | null {
  const n = lineAt(turns, first, ts);
  return n !== null ? cite(n) : null;
}

/** A glyph on the percussion line. Buzzes are filled in their hue; quiet marks are --ink-3 outline. */
function ScoreMark({ mark, left, cite: c, practice }: { mark: Mark; left: string; cite: string | null; practice: boolean }) {
  const title = `${mark.title}: ${mark.detail}`;
  const [delay] = useState(() => (mark.kind === 'nudge' && !practice ? Math.max(0, TAKEOVER_MS - (Date.now() - mark.at)) : 0));
  if ((mark.kind === 'nudge' || mark.kind === 'status') && mark.pattern) {
    // the takeover folds and a copy of the glyph lands here (§5.3)
    return (
      <span className="absolute top-[84px]" style={{ left, animation: delay ? `fade-in 200ms var(--ease-enter) ${delay}ms both` : undefined }} title={title}>
        <Glyph pattern={mark.pattern} size={34} />
      </span>
    );
  }
  if (mark.kind === 'quiet' && mark.pattern) {
    return <span className="absolute top-[86px]" style={{ left }} title={`Quiet mark: ${title}`}><Glyph pattern={mark.pattern} size={32} quiet /></span>;
  }
  if (mark.kind === 'bookmark') {
    return (
      <span className="absolute top-[86px] flex items-end gap-1" style={{ left }} title={title} aria-label={`Bookmark ${c ?? ''}`}>
        <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden><path d="M0 0h8v12l-4-3-4 3z" fill="var(--ink)" /></svg>
        {c && <span className="num-s leading-none text-ink">{c}</span>}
      </span>
    );
  }
  if (mark.kind === 'signal') {
    return <span className="absolute top-[103px] h-[9px] w-[9px] -translate-x-1/2 rotate-45 border border-ink-2 bg-paper" style={{ left }} title={title} />;
  }
  return null;
}

// ---------- the script: transcript with marginalia ----------
function Script({ state }: { state: BusState }) {
  const ref = useRef<HTMLDivElement>(null);
  const count = state.turns.length;
  const partial = state.partial?.text ?? '';
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, partial]);
  const fillers = state.coach?.filler_words ?? [];
  const { lines } = useMemo(() => layout(state.turns), [state.turns]);
  const upper = upperEdge(state);
  const sub = state.partial ? subtitle(state.partial.text) : [];
  return (
    <section aria-label="Transcript">
      <div ref={ref} className={`no-scrollbar -ml-[var(--margin-l)] max-h-[max(340px,calc(100vh-560px))] overflow-y-auto ${count ? 'min-h-[280px]' : ''} pl-[var(--margin-l)]`}>
        {state.turns.map((t, i) => {
          const until = state.turns[i + 1]?.start ?? Infinity;
          const marks = state.marks.filter((m) => m.kind !== 'nudge' && m.kind !== 'status' && m.ts >= (i === 0 ? -1 : t.start) && m.ts < until);
          return <TurnRow key={t.turn_id} turn={t} lines={lines.filter((l) => l.turn === i)} marks={marks} fillers={fillers} upper={upper} quietEvery />;
        })}
        {count === 0 && !state.partial && <p className="display-s py-6 italic text-ink-3">Listening</p>}
      </div>
      <div className="mt-2 grid min-h-[96px] gap-x-6 border-t border-rule pt-4 md:grid-cols-[96px_minmax(0,1fr)]" aria-live="off">
        {state.partial && sub.length > 0 && (
          <>
            <div className="label pt-2">{state.partial.speaker === 'other' ? 'them' : state.partial.speaker === 'me' ? 'you' : ''}</div>
            <p className={`text-[clamp(24px,2.3vw,32px)] leading-[1.25] ${state.partial.speaker === 'other' ? 'text-ink-2 md:pl-8' : 'text-ink'}`}>
              {sub.map((l, i) => <span key={i} className={`block ${i === sub.length - 1 ? 'caret' : ''}`}>{l}</span>)}
            </p>
          </>
        )}
      </div>
    </section>
  );
}

function underlineFillers(text: string, words: string[]) {
  const list = [...new Set(words.map((w) => w.trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return text;
  const re = new RegExp(`\\b(${list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
  return text.split(re).map((part, i) => (i % 2 === 1
    ? <span key={i} className="underline decoration-ochre decoration-2 underline-offset-[3px]">{part}</span>
    : <Fragment key={i}>{part}</Fragment>));
}

function interrupted(turn: TurnView): boolean {
  const a = turn.judge?.results.interrupted;
  return turn.speaker === 'me' && a?.kind === 'noul' && a.p >= 0.5;
}

export function TurnRow({ turn, lines, marks, fillers, upper, quietEvery }: {
  turn: TurnView; lines: Line[]; marks: Mark[]; fillers: string[]; upper: number | null; quietEvery?: boolean;
}) {
  const me = turn.speaker === 'me';
  const fast = me && upper !== null && turn.wpm > upper;
  const words = [...turn.fillers, ...fillers];
  return (
    <div className="anim-rise grid grid-cols-1 gap-x-6 gap-y-2 border-t border-rule py-4 first:border-t-0 md:grid-cols-[96px_minmax(0,1fr)] xl:grid-cols-[96px_minmax(0,1fr)_200px]">
      <div className="flex items-baseline gap-3 md:block">
        <div className={`label ${me ? '!text-ink' : ''}`}>{me ? 'you' : 'them'}</div>
        <div className="num-s text-ink-3">{clock(turn.start)}</div>
        {me && <div className={`num-s ${fast ? 'text-blue-text' : 'text-ink-2'}`}>{Math.round(turn.wpm)} wpm</div>}
      </div>
      <div className={`text-l relative ${me ? 'text-ink' : 'text-ink-2 md:pl-8'}`}>
        {interrupted(turn) && <svg className="absolute -left-5 top-[0.5em]" width="12" height="10" viewBox="0 0 12 10" role="img" aria-label="Started over them"><title>Started over them</title><path d="M1 9 L6 1.5 L11 9" fill="none" stroke="var(--vermilion)" strokeWidth="2" /></svg>}
        {lines.map((l) => (
          <span key={l.n} className="relative md:block">
            {(!quietEvery || l.line % 5 === 0) && (
              <span className="num-s absolute top-[0.45em] hidden w-12 text-right text-ink-3 md:block" style={{ right: `calc(100% + ${me ? 96 + 24 + 16 : 96 + 24 + 16 + 32}px)` }}>{l.line}</span>
            )}
            {me ? underlineFillers(l.text, words) : l.text}{' '}
          </span>
        ))}
      </div>
      <aside className="text-s space-y-1.5 pt-1 empty:hidden md:col-start-2 xl:col-start-auto" aria-label="Margin notes">
        {turn.judge && <Verdicts results={turn.judge.results} />}
        {marks.map((m) => <MarginMark key={m.id} mark={m} />)}
        {turn.judge && <div className="num-s text-ink-3" title={`Judged by ${turn.judge.source}`}>{Math.round(turn.judge.latency_ms)} ms</div>}
      </aside>
    </div>
  );
}

const LABEL: Record<string, string> = {
  interrupted: 'interrupted', hedging: 'hedging', rambling: 'rambling', asked_question: 'asked a question',
  commitment_made: 'made a promise', answered_the_question: 'answered the question', acknowledged: 'acknowledged them',
};

function Verdicts({ results }: { results: Record<string, JudgeAnswer> }) {
  const rows: { key: string; text: string; value: string; confidence: number }[] = [];
  for (const [key, a] of Object.entries(results)) {
    if (a.kind === 'noul') {
      if (a.p >= 0.5) rows.push({ key, text: LABEL[key] ?? key.replace(/_/g, ' '), value: a.p.toFixed(2), confidence: a.confidence });
    } else if (a.kind === 'choice') {
      if (a.choice !== 'none') rows.push({ key, text: `${key.replace(/_/g, ' ')}: ${a.choice}`, value: a.confidence.toFixed(2), confidence: a.confidence });
    } else {
      rows.push({ key, text: key.replace(/_/g, ' '), value: `${a.score.toFixed(1)}/${a.max}`, confidence: a.confidence });
    }
  }
  return (
    <>
      {rows.slice(0, 7).map((r) => (
        <div key={r.key} className={`flex justify-between gap-3 ${r.confidence < 0.6 ? 'text-ink-3' : 'text-ink-2'}`} title={r.confidence < 0.6 ? 'Low confidence' : undefined}>
          <span className="italic">{r.text}</span><span className="num-s">{r.value}</span>
        </div>
      ))}
    </>
  );
}

function MarginMark({ mark }: { mark: Mark }) {
  if (mark.kind === 'quiet' && mark.pattern) {
    return (
      <div className="flex items-start gap-2 pt-0.5" title="A rule fired. In a real conversation it does not buzz.">
        <span className="mt-[2px]"><Glyph pattern={mark.pattern} size={14} quiet /></span>
        <span><span className="text-ink">{mark.title}</span> <span className="italic text-ink-3">quietly</span><br /><span className="italic text-ink-2">{mark.detail}</span></span>
      </div>
    );
  }
  return (
    <div className="pt-0.5">
      <span className="flex items-center gap-2 text-ink">
        {mark.kind === 'signal' && <span className="inline-block h-[8px] w-[8px] rotate-45 border border-ink-2" aria-hidden />}
        {mark.kind === 'bookmark' && <svg width="7" height="10" viewBox="0 0 8 12" aria-hidden><path d="M0 0h8v12l-4-3-4 3z" fill="var(--ink)" /></svg>}
        {mark.kind === 'signal' ? `Observed: ${mark.title.toLowerCase()}` : mark.title}
      </span>
      <div className="italic text-ink-2">{mark.detail}</div>
    </div>
  );
}

// ---------- right rail: the quiet log ----------
function Rail({ state, practice }: { state: BusState; practice: boolean }) {
  const m = state.metrics;
  const mono = m?.monologue_s ?? 0;
  const fill = Math.min(1, mono / MONOLOGUE_LIMIT);
  const nudges = state.marks.filter((x) => x.kind === 'nudge' || x.kind === 'status');
  const quiet = state.marks.filter((x) => x.kind === 'quiet');
  return (
    <aside aria-label="Quiet log" className="space-y-8">
      <div>
        <div className="flex items-baseline justify-between">
          <span className="num-l">{mono.toFixed(0)}<span className="unit">s</span></span>
          <span className="text-s text-ink-2">this turn, limit <span className="num-s text-ink">{MONOLOGUE_LIMIT}</span> s</span>
        </div>
        <div className="relative mt-3 h-[2px] bg-rule">
          <div className="absolute inset-0 origin-left bg-ink" style={{ transform: `scaleX(${fill})`, transition: 'transform 500ms linear' }} />
        </div>
      </div>

      <dl className="space-y-3 border-t border-rule pt-4">
        <Count value={m ? m.fillers_per_min.toFixed(1) : '–'} label="fillers a minute" />
        <Count value={m ? String(m.questions) : '–'} label={m?.questions === 1 ? 'question asked' : 'questions asked'} />
        <Count value={m ? String(m.interruptions) : '–'} label={m?.interruptions === 1 ? 'interruption' : 'interruptions'} />
      </dl>

      {!practice && <Log title="Buzzed" empty="Nothing has buzzed." marks={nudges} />}
      <Log title="Quiet marks" count={quiet.length} empty="No slips yet." marks={quiet} quiet />
    </aside>
  );
}

function Count({ value, label }: { value: string; label: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-4">
      <dd className="num-l w-[4ch] text-[clamp(36px,3vw,44px)]">{value}</dd>
      <dt className="text-s text-ink-2">{label}</dt>
    </div>
  );
}

function Log({ title, count, marks, empty, quiet }: { title: string; count?: number; marks: Mark[]; empty: string; quiet?: boolean }) {
  return (
    <div className="border-t border-rule pt-4">
      <div className="label mb-2">{title}{count !== undefined && <span className="num-s ml-2 text-ink-3">{count}</span>}</div>
      {marks.length === 0 && <p className="text-s text-ink-3">{empty}</p>}
      <ol className="space-y-2">
        {marks.slice(-6).reverse().map((m) => (
          <li key={m.id} className="anim-rise text-s grid grid-cols-[3.4ch_auto_1fr] items-center gap-x-3">
            <span className="num-s text-ink-3">{clock(m.ts)}</span>
            <span className="flex w-[34px] justify-start">{m.pattern && <Glyph pattern={m.pattern} size={14} quiet={quiet} />}</span>
            <span className={quiet ? 'text-ink-2' : 'text-ink'}>
              {m.title}
              {m.latency_ms !== null && m.latency_ms >= 50 && <span className="num-s ml-2 text-ink-3">{(m.latency_ms / 1000).toFixed(1)} s</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ---------- idle ----------
function RuleRow({ rule, buzzes }: { rule: NudgeRule; buzzes: boolean }) {
  return (
    <li className="grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-x-5 border-t border-rule py-3">
      <Glyph pattern={rule.haptic} size={34} quiet={!buzzes} />
      <span>
        <span className="display-s block">{rule.message}</span>
        <code className="num-s text-ink-3">{rule.when}</code>
      </span>
      <span className={`text-s ${buzzes ? 'text-blue-text' : 'text-ink-3'}`}>{buzzes ? 'the one buzz' : 'tracked quietly'}</span>
    </li>
  );
}

function Idle({ state }: { state: BusState }) {
  const coach = state.coach;
  const rules = useMemo(() => (coach ? [...coach.nudge_rules, ...coach.motion_rules].filter((r) => r.enabled !== false) : []), [coach]);
  const focus = coach?.nudge_policy.focus_rule_id;
  return (
    <div className="grid gap-x-6 gap-y-12 pt-16 xl:grid-cols-12">
      <div className="xl:col-span-7">
        <div className="text-s mb-6 flex items-center gap-2 text-ink-2">
          <span className={`state ${state.band?.connected ? 'state-on' : ''}`} aria-hidden />
          {state.band?.connected ? 'Band connected, mic off' : 'Waiting for the band'}
        </div>
        <h1 className="display-l max-w-[14ch]">Double-tap the band to begin.</h1>
        <p className="text-m mt-6 max-w-[52ch] text-ink-2">The light goes solid blue while it listens. In a real conversation the phone taps you for one thing only, talking too fast. The rest is written down for afterwards.</p>
        {state.debrief && <Link href="/debrief" className="btn mt-8">Read the last debrief</Link>}
      </div>
      <div className="xl:col-span-5">
        <div className="flex items-baseline justify-between gap-4 border-b border-ink pb-3">
          <span className="display-m">{coach ? (/coach$/i.test(coach.name) ? coach.name : `${coach.name} coach`) : 'No coach yet'}</span>
          <Link href="/studio" className="text-s link text-ink-2">Change in Studio</Link>
        </div>
        {coach && <p className="text-s mt-3 max-w-[60ch] text-ink-2">{coach.goal}</p>}
        <ul className="mt-5">{rules.map((r) => <RuleRow key={r.id} rule={r} buzzes={r.id === focus} />)}</ul>
      </div>
    </div>
  );
}
