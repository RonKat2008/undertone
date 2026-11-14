'use client';

import { useEffect, useRef, useState } from 'react';
import { Glyph } from '@/components/glyph';
import { SampleTag } from '@/components/sample-tag';
import { activateCoach, buildCoach, buildPersonalCoach, getProfile, listCoaches, saveCoach, type Sampled } from '@/lib/api/client';
import type { CoachQuestion, CoachSpec, HabitProfile, HapticPattern, NudgeRule } from '@/lib/bus/contracts';
import { PATTERNS, PATTERN_ORDER } from '@/lib/bus/patterns';
import { useBus } from '@/lib/bus/use-bus';

const EXAMPLES = [
  'stop saying “like” and sound confident in case interviews',
  'listen more than I talk when my co-founder is upset',
  'pitch our drone startup in ninety seconds without rushing',
];
const STAGES = ['Name and goal', 'Questions for the judge', 'Nudge rules', 'Crutch words and key terms', 'Debrief rubric', 'Practice drills'];

type Phase = 'empty' | 'generating' | 'sheet';

export default function StudioPage() {
  const { state, inject, kind } = useBus();
  const [phase, setPhase] = useState<Phase>('empty');
  const [goal, setGoal] = useState('');
  const [stage, setStage] = useState(0);
  const [draft, setDraft] = useState<CoachSpec | null>(null);
  const [library, setLibrary] = useState<CoachSpec[]>([]);
  const [profile, setProfile] = useState<Sampled<HabitProfile> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    listCoaches().then((c) => on && setLibrary(c)).catch(() => on && setError('Could not load the coach library.'));
    getProfile().then((p) => on && setProfile(p));
    // ?demo=generating | ?demo=sheet : jump straight to a state (rehearsal, screenshots)
    const demo = new URLSearchParams(window.location.search).get('demo');
    if (demo === 'generating') { setGoal(EXAMPLES[0]); setPhase('generating'); setStage(3); }
    if (demo === 'sheet') void buildCoach(`I want to ${EXAMPLES[0]}`).then((c) => { if (on) { setGoal(EXAMPLES[0]); setDraft(c); setPhase('sheet'); } });
    return () => { on = false; };
  }, []);

  useEffect(() => {
    if (phase !== 'generating') return;
    const id = setInterval(() => setStage((s) => Math.min(STAGES.length, s + 1)), 420);
    return () => clearInterval(id);
  }, [phase]);

  async function build(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setError(null); setStage(0); setPhase('generating'); setSaved(null);
    try {
      setDraft(await buildCoach(`I want to ${clean}`));
      setPhase('sheet');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The coach could not be written.');
      setPhase('empty');
    }
  }

  async function activate(coach: CoachSpec) {
    setBusy(true); setError(null);
    try {
      if (coach.kind !== 'prebuilt') await saveCoach(coach);
      const active = (await activateCoach(coach.id)) ?? coach;
      if (kind === 'mock') inject({ type: 'coach.activated', coach: active });
      setLibrary(await listCoaches());
      setSaved(`${active.name} is the active coach.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not activate the coach.');
    } finally {
      setBusy(false);
    }
  }

  async function openPersonal() {
    setError(null);
    try { setDraft(await buildPersonalCoach()); setPhase('sheet'); setSaved(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not build the personal coach.'); }
  }

  return (
    <div className="pt-8">
      <div className="label mb-5">Coach studio</div>
      <form onSubmit={(e) => { e.preventDefault(); void build(goal); }} className="border-b border-rule pb-8">
        <label className="display-l flex flex-wrap items-baseline gap-x-4 xl:max-w-[calc(100%*10/12)]">
          <span className="shrink-0">I want to</span>
          <textarea value={goal} onChange={(e) => setGoal(e.target.value)} disabled={phase === 'generating'} autoComplete="off" spellCheck={false}
            rows={goal.length > 70 ? 3 : goal.length > 32 ? 2 : 1} placeholder="…" aria-label="Your goal, in one sentence"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void build(goal); } }}
            className="serif min-w-[260px] flex-1 resize-none border-0 bg-transparent italic leading-[1.05] outline-none placeholder:text-ink-3" />
        </label>
        <ul className="mt-6 space-y-1.5" aria-label="Or try one of these">
          {EXAMPLES.map((ex) => (
            <li key={ex} className="flex items-baseline gap-3">
              <span className="text-s text-ink-3">or</span>
              <button type="button" onClick={() => { setGoal(ex); void build(ex); }} disabled={phase === 'generating'}
                className="display-s text-left italic text-ink-2 decoration-rule-strong decoration-1 underline-offset-[6px] hover:text-ink hover:underline">{ex}</button>
            </li>
          ))}
        </ul>
        <button type="submit" className="btn btn-solid mt-7" disabled={!goal.trim() || phase === 'generating'}>{phase === 'generating' ? 'Writing…' : 'Write this coach'}</button>
      </form>
      {error && <p role="alert" className="text-m mt-3 font-medium text-ink">{error}</p>}
      {saved && <p role="status" className="text-m mt-3 text-ink-2">{saved}</p>}

      {phase === 'generating' && <Generating stage={stage} goal={goal} />}
      {phase === 'sheet' && draft && <Sheet coach={draft} onChange={setDraft} onActivate={() => activate(draft)} busy={busy} active={state.coach?.id === draft.id} />}

      <Library coaches={library} activeId={state.coach?.id ?? null} profile={profile} onOpen={(c) => { setDraft(c); setPhase('sheet'); setSaved(null); }}
        onActivate={activate} onPersonal={openPersonal} busy={busy} />
    </div>
  );
}

function Generating({ stage, goal }: { stage: number; goal: string }) {
  return (
    <section className="mt-10 grid gap-x-6 gap-y-6 xl:grid-cols-12" aria-live="polite">
      <div className="xl:col-span-4">
        <div className="display-m">Writing your coach</div>
        <p className="text-m mt-3 max-w-[40ch] text-ink-2">From one sentence: “I want to {goal}”. The judge’s questions come first, then the rules that follow from them.</p>
      </div>
      <ol className="xl:col-span-7 xl:col-start-6">
        {STAGES.map((s, i) => (
          <li key={s} className={`grid grid-cols-[40px_minmax(0,1fr)_auto] items-baseline border-b border-rule py-3.5 ${i <= stage ? 'anim-rise' : ''}`}>
            <span className="num-s text-ink-3">{String(i + 1).padStart(2, '0')}</span>
            <span className={`display-s ${i < stage ? 'text-ink' : i === stage ? 'text-ink' : 'text-ink-3'}`}>{s}</span>
            <span className="text-s">{i < stage ? <span className="text-ink-2">written</span> : i === stage ? <span className="caret text-ink">writing</span> : null}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Chips({ label, values, onChange, tone }: { label: string; values: string[]; onChange: (v: string[]) => void; tone?: boolean }) {
  const [text, setText] = useState('');
  const add = () => { const v = text.trim(); if (v && !values.includes(v)) onChange([...values, v]); setText(''); };
  return (
    <div>
      <div className="label mb-2">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <span key={v} className={`chip ${tone ? 'border-ochre bg-ochre-tint text-ochre-text' : ''}`}>{v}
            <button aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="text-ink-3 hover:text-ink">×</button>
          </span>
        ))}
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur={add}
          placeholder="add…" aria-label={`Add to ${label}`} className="field text-s h-7 !w-28" />
      </div>
    </div>
  );
}

function QuestionRow({ id, q }: { id: string; q: CoachQuestion }) {
  return (
    <li className="grid grid-cols-[88px_1fr] gap-x-6 border-b border-rule py-4">
      <span className="label pt-0.5 !text-ink">{q.type === 'noul' ? 'yes or no' : q.type}</span>
      <div>
        <div className="num-s text-ink-3">{id}</div>
        <p className="text-m">{q.instructions}</p>
        {q.type === 'choice' && <div className="mt-2 flex flex-wrap gap-1.5">{Object.keys(q.criteria).map((c) => <span key={c} className="chip" title={q.criteria[c]}>{c}</span>)}</div>}
        {q.type === 'score' && (
          <ol className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-4">
            {q.criteria.map((c, i) => <li key={i} className="text-s border-t border-ink pt-1.5 text-ink-2" style={{ borderTopWidth: 1 + i * 0.5 }}><span className="num-s mr-1.5 text-ink">{i + 1}</span>{c}</li>)}
          </ol>
        )}
      </div>
    </li>
  );
}

/** The haptic picker: shows the notation, not a native select. A small listbox. */
function HapticPicker({ value, onChange, label }: { value: HapticPattern; onChange: (p: HapticPattern) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(PATTERN_ORDER.indexOf(value));
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);
  const choose = (p: HapticPattern) => { onChange(p); setOpen(false); };
  return (
    <div ref={root} className="relative">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label}
        onClick={() => { setActive(PATTERN_ORDER.indexOf(value)); setOpen((o) => !o); }}
        onKeyDown={(e) => {
          if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); setOpen(true); return; }
          if (!open) return;
          if (e.key === 'Escape') { e.preventDefault(); setOpen(false); }
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(PATTERN_ORDER.length - 1, a + 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(PATTERN_ORDER[active]); }
        }}
        className="flex h-9 w-[168px] items-center justify-between gap-2 rounded-[var(--r-key)] border border-rule-strong px-2 hover:border-ink">
        <span className="flex w-[52px] items-center"><Glyph pattern={value} size={22} playing playKey={value} /></span>
        <span className="num-s truncate text-ink-2">{value}</span>
      </button>
      {open && (
        <ul role="listbox" aria-label={label} className="absolute left-0 top-full z-20 mt-1 w-[248px] border border-rule-strong bg-well py-1" style={{ boxShadow: 'var(--shadow-panel)' }}>
          {PATTERN_ORDER.map((p, i) => (
            <li key={p} role="option" aria-selected={p === value} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); choose(p); }}
              className={`grid cursor-pointer grid-cols-[64px_1fr] items-center gap-2 px-3 py-1.5 ${i === active ? 'bg-paper' : ''}`}>
              <Glyph pattern={p} size={22} />
              <span className="text-s"><span className={p === value ? 'text-ink' : 'text-ink-2'}>{PATTERNS[p].action}</span> <span className="num-s text-ink-3">{p}</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RuleEditor({ rule, onChange, mode, isFocus }: { rule: NudgeRule; onChange: (r: NudgeRule) => void; mode: 'regular' | 'practice'; isFocus: boolean }) {
  const buzzes = mode === 'practice' ? rule.enabled !== false : isFocus;
  return (
    <li className="grid grid-cols-1 items-center gap-x-5 gap-y-2 border-b border-rule py-3 md:grid-cols-[minmax(0,1fr)_168px_minmax(0,1fr)_112px]">
      <code className="num-s truncate text-ink-2" title={rule.when}>{rule.when}</code>
      <HapticPicker value={rule.haptic} onChange={(haptic) => onChange({ ...rule, haptic })} label={`Haptic for ${rule.id}`} />
      <input value={rule.message} onChange={(e) => onChange({ ...rule, message: e.target.value })} aria-label={`Message for ${rule.id}`} className="field display-s !border-b-rule leading-none" />
      {mode === 'practice' ? (
        <label className="text-s flex cursor-pointer items-center gap-2">
          <input type="checkbox" checked={rule.enabled !== false} onChange={(e) => onChange({ ...rule, enabled: e.target.checked })} />
          {buzzes ? 'buzzes in drills' : 'off'}
        </label>
      ) : (
        <span className={`text-s md:text-right ${buzzes ? 'text-blue-text' : 'text-ink-3'}`}>{buzzes ? 'the one buzz' : 'tracked quietly'}</span>
      )}
    </li>
  );
}

function Sheet({ coach, onChange, onActivate, busy, active }: { coach: CoachSpec; onChange: (c: CoachSpec) => void; onActivate: () => void; busy: boolean; active: boolean }) {
  const mode = coach.kind === 'personal' ? 'practice' : 'regular';
  const setRule = (list: 'nudge_rules' | 'motion_rules', i: number, r: NudgeRule) => onChange({ ...coach, [list]: coach[list].map((x, j) => (j === i ? r : x)) });
  const focus = coach.nudge_policy.focus_rule_id;
  return (
    <section className="anim-rise mt-12" aria-label="Coach sheet">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-2 border-ink pb-4">
        <div className="min-w-0 flex-1">
          <div className="label">{coach.kind} coach, {mode} mode</div>
          <input value={coach.name} onChange={(e) => onChange({ ...coach, name: e.target.value })} aria-label="Coach name" className="display-l w-full border-0 bg-transparent outline-none focus:underline" />
        </div>
        <button className="btn btn-solid h-11 px-6 text-[15px]" onClick={onActivate} disabled={busy}>{active ? 'Active, save changes' : 'Activate this coach'}</button>
      </div>
      <textarea value={coach.goal} onChange={(e) => onChange({ ...coach, goal: e.target.value })} rows={2} aria-label="Goal" className="field text-l mt-3 max-w-[64ch] resize-none border-b-0 text-ink-2" />

      <div className="mt-10 grid gap-x-6 gap-y-12 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <h2 className="display-s border-b border-ink pb-2">{mode === 'regular' ? 'Rules. In a real conversation only pace buzzes' : 'Rules. Which ones buzz during a drill'}</h2>
          <ul>
            {coach.nudge_rules.map((r, i) => <RuleEditor key={r.id} rule={r} mode={mode} isFocus={r.id === focus} onChange={(x) => setRule('nudge_rules', i, x)} />)}
            {coach.motion_rules.map((r, i) => <RuleEditor key={r.id} rule={r} mode={mode} isFocus={r.id === focus} onChange={(x) => setRule('motion_rules', i, x)} />)}
          </ul>
          <p className="text-s mt-3 text-ink-2">
            {mode === 'regular'
              ? `Budget ${coach.nudge_policy.budget_per_session} buzzes a conversation, ${coach.nudge_policy.min_gap_s} s apart, only past ${Math.round(coach.nudge_policy.tolerance * 100)}% over your own pace.`
              : 'No cap inside a 30 to 90 second round. One “success” at most per round.'}
          </p>

          <h2 className="display-s mt-12 border-b border-ink pb-2">What the judge asks after each of your turns</h2>
          <ul>{Object.entries(coach.questions).map(([id, q]) => <QuestionRow key={id} id={id} q={q} />)}</ul>
          {Object.keys(coach.questions).length === 0 && <p className="text-m pt-3 text-ink-3">Only the ten core questions. This coach adds none of its own.</p>}
        </div>

        <div className="space-y-10 xl:col-span-4 xl:col-start-9">
          <div>
            <div className="flex items-baseline justify-between"><span className="label">Sensitivity</span><span className="num-m">{coach.confidence_threshold.toFixed(2)}</span></div>
            <input type="range" min={0.5} max={0.95} step={0.01} value={coach.confidence_threshold} aria-label="Confidence threshold"
              onChange={(e) => onChange({ ...coach, confidence_threshold: Number(e.target.value) })} className="mt-2 w-full" />
            <div className="text-s flex justify-between text-ink-3"><span>marks more</span><span>only when sure</span></div>
          </div>
          <Chips label={mode === 'practice' ? 'Your crutch words' : 'Filler words'} values={coach.filler_words} onChange={(v) => onChange({ ...coach, filler_words: v })} tone />
          <Chips label="Key terms for the transcriber" values={coach.keyterms} onChange={(v) => onChange({ ...coach, keyterms: v })} />
          <div>
            <div className="label mb-1">Debrief rubric</div>
            <textarea value={coach.debrief_rubric} onChange={(e) => onChange({ ...coach, debrief_rubric: e.target.value })} rows={3} className="field text-m resize-none" aria-label="Debrief rubric" />
          </div>
          <div>
            <div className="label mb-1">Practice drills</div>
            <ol>{coach.drill.prompts.map((p, i) => (
              <li key={i} className="grid grid-cols-[24px_1fr] items-baseline border-b border-rule py-2">
                <span className="num-s text-ink-3">{i + 1}</span>
                <input value={p} aria-label={`Drill prompt ${i + 1}`} className="display-s w-full border-0 bg-transparent italic outline-none focus:underline"
                  onChange={(e) => onChange({ ...coach, drill: { ...coach.drill, prompts: coach.drill.prompts.map((x, j) => (j === i ? e.target.value : x)) } })} />
              </li>
            ))}</ol>
            <p className="text-s mt-2 text-ink-2">Partner: {coach.drill.partner_persona}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

const TREND = { better: 'getting better', same: 'steady', worse: 'rising' } as const;

function Library({ coaches, activeId, profile, onOpen, onActivate, onPersonal, busy }: {
  coaches: CoachSpec[]; activeId: string | null; profile: Sampled<HabitProfile> | null;
  onOpen: (c: CoachSpec) => void; onActivate: (c: CoachSpec) => void; onPersonal: () => void; busy: boolean;
}) {
  const others = coaches.filter((c) => c.kind !== 'personal');
  const p = profile?.data;
  return (
    <section className="mt-20" aria-label="Coach library">
      <h2 className="display-s border-b border-ink pb-2">Library</h2>
      <div className="grid gap-x-6 gap-y-6 xl:grid-cols-12">
        <ul className="xl:col-span-7">
          {others.map((c) => (
            <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 border-b border-rule py-4">
              <button onClick={() => onOpen(c)} className="group min-w-0 text-left">
                <span className="display-m group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">{c.name}</span>
                <span className="text-s ml-3 text-ink-2">{c.kind}{c.id === activeId ? ', active' : ''}</span>
                <span className="text-m mt-1 block truncate text-ink-2">{c.goal}</span>
              </button>
              <button className={`btn ${c.id === activeId ? 'btn-quiet' : ''}`} disabled={busy || c.id === activeId} onClick={() => onActivate(c)}>{c.id === activeId ? 'Active' : 'Activate'}</button>
            </li>
          ))}
          {others.length === 0 && <li className="text-m py-3 text-ink-3">No coaches yet.</li>}
        </ul>
        <div className="border-b border-rule py-4 xl:col-span-4 xl:col-start-9">
          <div className="flex items-baseline justify-between gap-3">
            <span className="flex flex-wrap items-baseline gap-x-3"><span className="display-m">Personal</span><span className="text-s text-ink-2">practice mode</span><SampleTag show={profile?.sample ?? false} /></span>
            <button className="btn" onClick={onPersonal}>Open</button>
          </div>
          <p className="text-m mt-1 text-ink-2">Built from your own last <span className="num-s">{p?.sessions ?? 0}</span> conversations. It drills the words you lean on.</p>
          {p && (
            <div className="mt-5 grid grid-cols-2 gap-x-6">
              <div>
                <div className="label mb-2">Crutch words a minute</div>
                {p.crutch_words.map((w) => (
                  <div key={w.word} className="grid grid-cols-[1fr_auto] items-center gap-3 py-[3px]">
                    <span className="relative h-6">
                      <span className="absolute inset-y-0 left-0 bg-ochre-tint" style={{ width: `${Math.min(100, (w.per_min / 3) * 100)}%` }} />
                      <span className="text-m relative pl-1.5 leading-6">{w.word}</span>
                    </span>
                    <span className="num-s text-ochre-text">{w.per_min.toFixed(1)}</span>
                  </div>
                ))}
                {p.crutch_words.length === 0 && <p className="text-s text-ink-3">Not enough conversations yet.</p>}
              </div>
              <div>
                <div className="label mb-2">Recurring</div>
                {p.recurring_issues.map((r) => (
                  <div key={r.rule_id} className="text-s py-1"><div className="text-ink">{r.label}</div><div className="italic text-ink-2">{TREND[r.trend]}</div></div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
        <span className="label">Vocabulary</span>
        {PATTERN_ORDER.slice(0, 6).map((pt) => <span key={pt} className="text-s flex items-center gap-2 text-ink-2"><Glyph pattern={pt} size={18} />{PATTERNS[pt].action.toLowerCase()}</span>)}
      </div>
    </section>
  );
}
