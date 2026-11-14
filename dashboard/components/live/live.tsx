'use client';

import Link from 'next/link';
import { Fragment, useEffect, useMemo, useRef } from 'react';
import { Glyph } from '@/components/glyph';
import { clock } from '@/components/shell';
import { Spark } from '@/components/spark';
import type { CoachSpec, JudgeAnswer, NudgeRule } from '@/lib/bus/contracts';
import { PATTERNS } from '@/lib/bus/patterns';
import { isLive, type BusState, type Mark, type TurnView } from '@/lib/bus/reducer';
import { useBus, useNow } from '@/lib/bus/use-bus';

const MONOLOGUE_LIMIT = 45;

/** The coach's talk-share target, read from a rule like "metrics.talk_ratio > 0.4". */
function talkTarget(coach: CoachSpec | null): number {
  const rule = coach?.nudge_rules.find((r) => r.when.includes('metrics.talk_ratio'));
  const n = rule ? Number(rule.when.split(/[<>=]+/).pop()) : NaN;
  return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.5;
}

export function LiveScreen() {
  const { state } = useBus();
  const now = useNow(500);
  const session = state.session;
  if (!session || (!isLive(state) && state.turns.length === 0)) return <Idle state={state} />;
  const elapsed = ((session.endedAt ?? now) - session.startedAt) / 1000;
  const practice = session.mode === 'practice';
  return (
    <div className="pt-5">
      {session.endedAt !== null && (
        <div className="anim-rise mb-4 flex items-baseline justify-between border-b border-rule pb-3">
          <span className="serif text-[26px]">{practice ? 'Round finished.' : 'Conversation ended.'}</span>
          {!practice && (state.debrief
            ? <Link className="btn btn-solid" href="/debrief">Read the debrief</Link>
            : <span className="caps">Writing the debrief…</span>)}
        </div>
      )}
      {!practice && <Spine state={state} />}
      <Timeline state={state} elapsed={elapsed} />
      <div className="mt-9 grid gap-x-10 gap-y-8 lg:grid-cols-[230px_minmax(0,1fr)_300px] xl:grid-cols-[250px_minmax(0,1fr)_330px]">
        <div className="order-2 lg:order-1">{practice ? <PracticePanel state={state} /> : <RegularPanel state={state} />}</div>
        <div className="order-1 min-w-0 lg:order-2"><Script state={state} /></div>
        <div className="order-3"><Instruments state={state} /></div>
      </div>
    </div>
  );
}

// ---------- the spine: talk ratio ----------
function Spine({ state }: { state: BusState }) {
  const ratio = state.metrics?.talk_ratio ?? 0;
  const target = talkTarget(state.coach);
  const pct = Math.round(ratio * 100);
  return (
    <section aria-label="Talk ratio" className="grid grid-cols-[auto_1fr_auto] items-end gap-x-6">
      <div>
        <div className="caps">You</div>
        <div className="num text-[72px] leading-[0.85]">{pct}<span className="text-[28px] text-ink-2">%</span></div>
      </div>
      <div className="relative mb-1.5 h-9 bg-them">
        <div className="absolute inset-y-0 left-0 w-full origin-left bg-ink transition-transform duration-700 ease-out" style={{ transform: `scaleX(${ratio})` }} />
        <div className="absolute -top-4 bottom-[-6px] w-px bg-ink" style={{ left: `${target * 100}%` }}>
          <span className="caps absolute -top-0.5 left-1.5 whitespace-nowrap">target {Math.round(target * 100)}%</span>
        </div>
      </div>
      <div className="text-right">
        <div className="caps">Them</div>
        <div className="num text-[28px] leading-[0.85] text-ink-2">{100 - pct}%</div>
      </div>
    </section>
  );
}

// ---------- the timeline: the whole session on one line ----------
function Timeline({ state, elapsed }: { state: BusState; elapsed: number }) {
  // session time can run ahead of the wall clock (fixture replay at speed), so measure both
  const latest = Math.max(elapsed, state.turns.at(-1)?.end ?? 0, state.marks.at(-1)?.ts ?? 0);
  const span = Math.max(60, latest * 1.04);
  const left = (t: number) => `${Math.min(100, (t / span) * 100)}%`;
  return (
    <section aria-label="Session timeline" className="relative mt-3 h-[46px] border-b border-rule [clip-path:inset(-4px_0_-24px_0)]">
      {state.turns.map((t) => (
        <div key={t.turn_id} title={`${t.speaker === 'me' ? 'You' : 'Them'} ${clock(t.start)}`}
          className={`absolute h-2 ${t.speaker === 'me' ? 'top-[26px] bg-ink' : 'top-[36px] bg-them'}`}
          style={{ left: left(t.start), width: `${Math.max(0.3, ((t.end - t.start) / span) * 100)}%` }} />
      ))}
      {state.marks.map((m) => <TimelineMark key={m.id} mark={m} left={left(m.ts)} />)}
      <div className="absolute bottom-0 top-0 w-px bg-ink/40" style={{ left: left(latest) }} />
      <span className="num absolute -bottom-5 left-0 text-[10px] text-ink-3">0:00</span>
      <span className="num absolute -bottom-5 right-0 text-[10px] text-ink-3">{clock(span)}</span>
    </section>
  );
}

function TimelineMark({ mark, left }: { mark: Mark; left: string }) {
  const title = `${mark.title} · ${mark.detail}`;
  if (mark.kind === 'nudge' && mark.pattern) {
    return <span className="absolute top-0 -translate-x-1/2" style={{ left }} title={title}><Glyph pattern={mark.pattern} size={20} /></span>;
  }
  if (mark.kind === 'quiet' && mark.pattern) {
    return <span className={`tone-${PATTERNS[mark.pattern].tone} absolute top-[10px] h-[14px] w-[3px] -translate-x-1/2`} style={{ left, background: 'var(--tone)' }} title={`Quiet mark: ${title}`} />;
  }
  if (mark.kind === 'bookmark') {
    return <span className="absolute top-[8px] -translate-x-1/2 text-[11px] leading-none" style={{ left }} title={title} aria-label="Bookmark">
      <svg width="9" height="13" viewBox="0 0 9 13"><path d="M0 0h9v13l-4.5-3.5L0 13z" fill={mark.rule_id === 'promise' ? 'var(--green)' : 'var(--ink)'} /></svg>
    </span>;
  }
  if (mark.kind === 'signal') {
    return <span className="absolute top-[9px] h-[11px] w-[11px] -translate-x-1/2 rotate-45 border border-ink bg-paper" style={{ left }} title={title} />;
  }
  return <span className="absolute top-[12px] h-[6px] w-[6px] -translate-x-1/2 rounded-full border border-ink" style={{ left }} title={title} />;
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
  return (
    <section aria-label="Transcript" ref={ref} className="no-scrollbar max-h-[calc(100vh-290px)] min-h-[320px] overflow-y-auto">
      {state.turns.map((t, i) => {
        const until = state.turns[i + 1]?.start ?? Infinity;
        const marks = state.marks.filter((m) => m.kind !== 'nudge' && m.kind !== 'status' && m.ts >= (i === 0 ? -1 : t.start) && m.ts < until);
        return <TurnRow key={t.turn_id} turn={t} marks={marks} fillers={fillers} />;
      })}
      {state.partial && (
        <div className="grid grid-cols-1 gap-x-6 gap-y-2 2xl:grid-cols-[minmax(0,1fr)_210px] min-[1360px]:grid-cols-[minmax(0,1fr)_210px] py-2">
          <p className={`caret text-[19px] leading-snug ${state.partial.speaker === 'other' ? 'pl-12 text-ink-2' : 'text-ink'}`}>{state.partial.text}</p>
        </div>
      )}
      {count === 0 && !state.partial && <p className="serif py-6 text-[24px] text-ink-3">Listening…</p>}
    </section>
  );
}

function underlineFillers(text: string, words: string[]) {
  const list = [...new Set(words.map((w) => w.trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return text;
  const re = new RegExp(`\\b(${list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'gi');
  return text.split(re).map((part, i) => (i % 2 === 1
    ? <span key={i} className="underline decoration-ochre decoration-[3px] underline-offset-[5px]">{part}</span>
    : <Fragment key={i}>{part}</Fragment>));
}

function TurnRow({ turn, marks, fillers }: { turn: TurnView; marks: Mark[]; fillers: string[] }) {
  const me = turn.speaker === 'me';
  return (
    <div className="anim-rise grid grid-cols-1 gap-x-6 gap-y-2 2xl:grid-cols-[minmax(0,1fr)_210px] min-[1360px]:grid-cols-[minmax(0,1fr)_210px] border-t border-rule py-3 first:border-t-0">
      <div className={me ? '' : 'pl-12'}>
        <div className="caps mb-1 flex gap-3"><span className={me ? '!text-ink' : ''}>{me ? 'You' : 'Them'}</span><span className="num tracking-normal">{clock(turn.start)}</span>{me && <span className="num tracking-normal">{Math.round(turn.wpm)} wpm</span>}</div>
        <p className={`text-[19px] leading-snug ${me ? 'text-ink' : 'text-ink-2'}`}>{me ? underlineFillers(turn.text, [...turn.fillers, ...fillers]) : turn.text}</p>
      </div>
      <aside className="max-w-[320px] space-y-1 border-l border-rule pl-4 pt-1 text-[12px] empty:hidden" aria-label="Margin notes">
        {turn.judge && <Verdicts results={turn.judge.results} />}
        {marks.map((m) => <MarginMark key={m.id} mark={m} />)}
        {turn.judge && <div className="num pt-0.5 text-[10.5px] tracking-normal text-ink-3">{turn.judge.source} · {Math.round(turn.judge.latency_ms)} ms</div>}
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
        <div key={r.key} className="flex justify-between gap-2" style={{ opacity: r.confidence < 0.7 ? 0.5 : 1 }} title={r.confidence < 0.7 ? 'Low confidence' : undefined}>
          <span>{r.text}</span><span className="num tracking-normal">{r.value}</span>
        </div>
      ))}
    </>
  );
}

function MarginMark({ mark }: { mark: Mark }) {
  if (mark.kind === 'quiet' && mark.pattern) {
    const tone = PATTERNS[mark.pattern].tone;
    return (
      <div className={`tone-${tone} flex items-start gap-2 pt-0.5`} title="A rule fired. In a real conversation it does not buzz.">
        <span className="mt-[3px]"><Glyph pattern={mark.pattern} size={11} /></span>
        <span><span style={{ color: 'var(--tone-text)' }}>{mark.title}</span> <span className="text-ink-3">· quiet</span><br /><span className="text-ink-2">{mark.detail}</span></span>
      </div>
    );
  }
  return (
    <div className="pt-0.5">
      <span className="caps !text-ink">{mark.kind === 'signal' ? `Observed: ${mark.title.toLowerCase()}` : mark.title}</span>
      <div className="text-ink-2">{mark.detail}</div>
    </div>
  );
}

// ---------- left column: mode, budget, log ----------
function Budget({ total, left, tone }: { total: number; left: number; tone: string }) {
  return (
    <div className={`tone-${tone} flex shrink-0 gap-1.5`} role="img" aria-label={`${left} of ${total} buzzes left`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className={`h-7 border ${total > 4 ? 'w-1.5' : 'w-2.5'} ${i < total - left ? 'opacity-40' : ''}`}
          style={{ borderColor: 'var(--tone)', background: i < total - left ? 'transparent' : 'var(--tone)' }} />
      ))}
    </div>
  );
}

function RegularPanel({ state }: { state: BusState }) {
  const policy = state.session?.policy;
  const total = Math.min(policy?.budget_per_session ?? 3, 12);
  const left = Math.min(state.budgetLeft ?? total, total);
  const focus = state.coach?.nudge_rules.find((r) => r.id === policy?.focus_rule_id);
  const nudges = state.marks.filter((m) => m.kind === 'nudge' || m.kind === 'status');
  const quiet = state.marks.filter((m) => m.kind === 'quiet');
  return (
    <section aria-label="Mode and buzz budget" className="space-y-6">
      <div>
        <div className="caps">Mode</div>
        <div className="serif text-[34px] leading-none">Regular</div>
        <p className="mt-2 text-[12.5px] text-ink-2">A real conversation. One thing may tap you: speed. Everything else is written down and waits for the debrief.</p>
      </div>
      <div className="border-t border-ink pt-3">
        <div className="caps mb-2">The one live nudge</div>
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 items-end gap-3"><Glyph pattern={focus?.haptic ?? 'slow_down'} size={total > 4 ? 22 : 30} /><span className="serif text-[24px] leading-none">{focus?.message ?? 'Slow down'}</span></div>
          <Budget total={total} left={left} tone={PATTERNS[focus?.haptic ?? 'slow_down'].tone} />
        </div>
        <div className="num mt-2 text-[11px] tracking-normal text-ink-2">{left} of {total} left · {policy?.min_gap_s ?? 120} s apart · +{Math.round((policy?.tolerance ?? 0.25) * 100)}% over your pace</div>
      </div>
      <Log title="Buzzed" empty="Nothing has buzzed." marks={nudges} />
      <Log title={`Quiet marks · ${quiet.length}`} empty="No slips yet." marks={quiet} faint />
    </section>
  );
}

function Log({ title, marks, empty, faint }: { title: string; marks: Mark[]; empty: string; faint?: boolean }) {
  return (
    <div className="border-t border-rule pt-3">
      <div className="caps mb-1.5">{title}</div>
      {marks.length === 0 && <p className="text-[12.5px] text-ink-3">{empty}</p>}
      <ol className="space-y-1.5">
        {marks.slice(-6).reverse().map((m) => (
          <li key={m.id} className="anim-rise grid grid-cols-[34px_1fr] items-baseline gap-x-2 text-[12.5px]">
            <span className="num tracking-normal text-ink-3">{clock(m.ts)}</span>
            <span className={faint ? 'text-ink-2' : ''}>
              <span className="mr-1.5 inline-block align-[-1px]">{m.pattern && <Glyph pattern={m.pattern} size={11} />}</span>
              {m.title}
              {m.latency_ms !== null && m.latency_ms >= 50 && <span className="num ml-1.5 tracking-normal text-ink-3">{(m.latency_ms / 1000).toFixed(1)} s</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function PracticePanel({ state }: { state: BusState }) {
  const p = state.practice;
  const coach = state.coach;
  const words = coach?.filler_words.length ? coach.filler_words : Object.keys(p.words);
  const prompt = coach?.drill.prompts[Math.floor((Math.max(1, p.round) - 1) / 2) % Math.max(1, coach?.drill.prompts.length ?? 1)] ?? 'Tell me about yourself.';
  const ended = state.session?.endedAt !== null;
  return (
    <section aria-label="Practice drill" className="space-y-6">
      <div>
        <div className="caps">Mode</div>
        <div className="serif text-[34px] leading-none">Practice</div>
        <p className="mt-2 text-[12.5px] text-ink-2">A drill, strict on purpose. Every one of your own crutch words gets a tap.</p>
      </div>
      <div className="border-t border-ink pt-3">
        <div className="caps mb-1">Round {Math.max(1, p.round)} · the prompt</div>
        <p className="serif text-[28px] leading-[1.05]">“{prompt}”</p>
      </div>
      <div className="border-t border-rule pt-3">
        <div className="caps mb-2">Your crutch words</div>
        <div className="flex flex-wrap gap-1.5">
          {words.map((w) => (
            <span key={w} className={`chip ${p.words[w] ? 'border-ochre' : ''}`}>
              {w}{p.words[w] ? <span className="num tracking-normal text-ochre-ink">×{p.words[w]}</span> : null}
            </span>
          ))}
        </div>
      </div>
      <div className="border-t border-rule pt-3">
        <div className="caps">{ended ? 'Round score' : 'Caught this round'}</div>
        <div className="flex items-end gap-3">
          {p.previous !== null && <><span className="num text-[56px] leading-[0.9] text-ink-3">{p.previous}</span><span className="num pb-1 text-[26px] text-ink-3">→</span></>}
          <span key={p.count} className="num anim-rise text-[88px] leading-[0.82] text-ochre-ink">{p.count}</span>
          <span className="pb-1"><Glyph pattern="filler" size={26} playing playKey={p.count} /></span>
        </div>
        <p className="mt-2 text-[12.5px] text-ink-2">
          {p.previous !== null ? `Last round ${p.previous}. This round ${p.count}${ended ? '.' : ' so far.'}` : 'First round. This sets the number to beat.'}
        </p>
        {p.success && <p className="mt-2 flex items-center gap-2 text-[13px] text-green"><Glyph pattern="success" size={14} playing />A cleaner round than the last one.</p>}
      </div>
    </section>
  );
}

// ---------- right rail: instruments ----------
function Instruments({ state }: { state: BusState }) {
  const m = state.metrics;
  const baseline = m?.baseline_wpm ?? null;
  const tol = state.session?.policy.tolerance || 0.25;
  const fast = baseline !== null && (m?.wpm ?? 0) > baseline * (1 + tol);
  const mono = m?.monologue_s ?? 0;
  const warm = Math.min(1, mono / MONOLOGUE_LIMIT);
  return (
    <section aria-label="Instruments" className="space-y-5">
      <div>
        <div className="flex items-baseline justify-between"><span className="caps">Pace</span><span className="caps">{baseline !== null ? `your usual ${Math.round(baseline)}` : 'finding your usual'}</span></div>
        <div className="flex items-end justify-between gap-3">
          <div className={`num text-[104px] leading-[0.82] transition-colors ${fast ? 'text-blue' : ''}`}>{m ? Math.round(m.wpm) : '–'}</div>
          <div className="pb-1 text-right">
            <Spark values={state.history.wpm.slice(-60)} capacity={60} width={120} height={44} min={100} max={240}
              band={baseline !== null ? [baseline * (1 - tol), baseline * (1 + tol)] : undefined} line={baseline ?? undefined} stroke={fast ? 'var(--blue)' : 'var(--ink)'} />
            <div className="caps mt-1">wpm · last 60 s</div>
          </div>
        </div>
      </div>

      <HandEnergy state={state} />

      <div className="grid grid-cols-3 border-t border-rule pt-3">
        <Stat label="Fillers / min" value={m ? m.fillers_per_min.toFixed(1) : '–'} />
        <Stat label="Questions" value={m ? String(m.questions) : '–'} />
        <Stat label="Interruptions" value={m ? String(m.interruptions) : '–'} />
      </div>

      <div className="border-t border-rule pt-3">
        <div className="flex items-baseline justify-between"><span className="caps">Volume</span><span className="num text-[11px] tracking-normal text-ink-2">{m ? `${m.volume_db.toFixed(0)} dBFS` : ''}</span></div>
        <div className="mt-1.5 grid grid-cols-3 gap-1">
          {(['quiet', 'ok', 'loud'] as const).map((v) => (
            <div key={v} className={`border py-1 text-center text-[12px] transition-colors ${m?.volume_state === v ? 'border-ink bg-ink text-paper' : 'border-rule text-ink-3'}`}>{v === 'ok' ? 'your usual' : v}</div>
          ))}
        </div>
      </div>

      <div className="border-t border-rule pt-3">
        <div className="flex items-baseline justify-between"><span className="caps">Current turn</span><span className="caps">limit {MONOLOGUE_LIMIT} s</span></div>
        <div className="flex items-end gap-3">
          <span className="num text-[40px] leading-[0.9]" style={{ color: warm > 0.33 ? `color-mix(in oklch, var(--ink), var(--amber-ink) ${Math.round(warm * 100)}%)` : undefined }}>{mono.toFixed(0)}<span className="text-[16px] text-ink-2"> s</span></span>
          <div className="relative mb-2 h-1.5 flex-1 bg-well">
            <div className="absolute inset-y-0 left-0 w-full origin-left transition-transform duration-500" style={{ transform: `scaleX(${warm})`, background: `color-mix(in oklch, var(--ink), var(--amber) ${Math.round(warm * 100)}%)` }} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div><div className="num text-[34px] leading-none">{value}</div><div className="caps mt-1">{label}</div></div>;
}

/** Hand energy: frozen, through natural gesturing, to overdoing it. */
function HandEnergy({ state }: { state: BusState }) {
  const e = state.motion?.hand_energy ?? state.metrics?.hand_energy ?? 0;
  const motion = state.motion;
  const word = e < 0.15 ? 'frozen' : e < 0.3 ? 'quiet' : e <= 0.7 ? 'natural' : e <= 0.85 ? 'busy' : 'overdoing it';
  const who = motion?.speaker_context === 'me' ? 'while you spoke' : motion?.speaker_context === 'other' ? 'while they spoke' : '';
  return (
    <div className="border-t border-ink pt-3">
      <div className="flex items-baseline justify-between"><span className="caps !text-ink">Hand energy</span><span className="caps">{motion ? `${motion.state} ${who}` : 'no motion yet'}</span></div>
      <div className="mt-1 flex items-end justify-between">
        <span className="serif text-[40px] leading-none">{word}</span>
        <span className="num text-[22px] leading-none text-ink-2">{e.toFixed(2)}</span>
      </div>
      <div className="relative mt-3 h-6 overflow-hidden">
        <div className="absolute inset-x-0 top-[11px] h-px bg-ink" />
        <div className="absolute top-[5px] h-[13px] border-x border-ink bg-well" style={{ left: '30%', width: '40%' }} />
        <div className="absolute left-0 top-0 h-6 w-[calc(100%-6px)] transition-transform duration-500 ease-out" style={{ transform: `translateX(${Math.min(1, Math.max(0, e)) * 100}%)` }}>
          <div className={`h-6 w-[6px] ${motion?.state === 'fidget' ? 'bg-violet' : 'bg-ink'}`} />
        </div>
      </div>
      <div className="caps mt-1 flex justify-between"><span>frozen</span><span>natural</span><span>overdoing</span></div>
      <Spark className="mt-2 w-full" values={state.history.energy.slice(-60)} capacity={60} width={300} height={34} min={0} max={1} band={[0.3, 0.7]} />
    </div>
  );
}

// ---------- idle ----------
function RuleRow({ rule, buzzes }: { rule: NudgeRule; buzzes: boolean }) {
  return (
    <li className="grid grid-cols-[120px_1fr_auto] items-center gap-4 border-t border-rule py-2.5">
      <Glyph pattern={rule.haptic} size={22} />
      <span className="serif text-[22px] leading-none">{rule.message}</span>
      <span className="caps">{buzzes ? 'buzzes' : 'tracked quietly'}</span>
    </li>
  );
}

function Idle({ state }: { state: BusState }) {
  const coach = state.coach;
  const rules = useMemo(() => (coach ? [...coach.nudge_rules, ...coach.motion_rules].filter((r) => r.enabled !== false) : []), [coach]);
  const focus = coach?.nudge_policy.focus_rule_id;
  return (
    <div className="grid gap-x-16 gap-y-10 pt-14 lg:grid-cols-[1.1fr_1fr]">
      <div>
        <div className="caps mb-4">{state.band?.connected ? 'Band connected · mic off' : 'Waiting for the band'}</div>
        <h1 className="serif text-[clamp(56px,7.5vw,124px)] leading-[0.9]">Double-tap the band to begin.</h1>
        <p className="mt-6 max-w-[46ch] text-[16px] text-ink-2">The light goes solid blue while it listens. In a real conversation the phone taps you for one thing only, talking too fast. The rest is written down for afterwards.</p>
        {state.debrief && <Link href="/debrief" className="btn mt-8">Read the last debrief</Link>}
      </div>
      <div>
        <div className="flex items-baseline justify-between border-b border-ink pb-2">
          <span className="serif text-[28px] leading-none">{coach ? (/coach$/i.test(coach.name) ? coach.name : `${coach.name} coach`) : 'No coach yet'}</span>
          <Link href="/studio" className="caps underline-offset-4 hover:text-ink hover:underline">Change in Studio</Link>
        </div>
        {coach && <p className="mt-3 max-w-[60ch] text-[13px] text-ink-2">{coach.goal}</p>}
        <ul className="mt-4">{rules.map((r) => <RuleRow key={r.id} rule={r} buzzes={r.id === focus} />)}</ul>
      </div>
    </div>
  );
}
