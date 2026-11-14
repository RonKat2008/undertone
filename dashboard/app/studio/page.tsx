'use client';

import { useEffect, useState } from 'react';
import { Glyph } from '@/components/glyph';
import { activateCoach, buildCoach, buildPersonalCoach, getProfile, listCoaches, saveCoach, type Fetched } from '@/lib/api/client';
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
  const { state, inject } = useBus();
  const [phase, setPhase] = useState<Phase>('empty');
  const [goal, setGoal] = useState('');
  const [stage, setStage] = useState(0);
  const [draft, setDraft] = useState<CoachSpec | null>(null);
  const [library, setLibrary] = useState<CoachSpec[]>([]);
  const [profile, setProfile] = useState<Fetched<HabitProfile> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    let on = true;
    listCoaches().then((c) => on && setLibrary(c)).catch((e: unknown) => on && setError(`Could not load the coach library. ${e instanceof Error ? e.message : ''}`.trim()));
    getProfile().then((p) => on && setProfile(p));
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
      inject({ type: 'coach.activated', coach: active });
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
      <div className="caps mb-4">Coach studio</div>
      <form onSubmit={(e) => { e.preventDefault(); void build(goal); }} className="border-b border-ink pb-5">
        <label className="serif flex flex-wrap items-baseline gap-x-4 text-[clamp(34px,4.4vw,64px)] leading-[1.05]">
          <span className="shrink-0">I want to</span>
          <textarea value={goal} onChange={(e) => setGoal(e.target.value)} disabled={phase === 'generating'} autoComplete="off" spellCheck={false}
            rows={goal.length > 70 ? 3 : goal.length > 32 ? 2 : 1} placeholder="…" aria-label="Your goal, in one sentence"
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void build(goal); } }}
            className="serif min-w-[280px] flex-1 resize-none border-0 bg-transparent italic outline-none placeholder:text-ink-3" />
        </label>
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          <button type="submit" className="btn btn-solid" disabled={!goal.trim() || phase === 'generating'}>{phase === 'generating' ? 'Writing…' : 'Write this coach'}</button>
          <span className="caps">or try</span>
          {EXAMPLES.map((ex) => (
            <button type="button" key={ex} onClick={() => { setGoal(ex); void build(ex); }} disabled={phase === 'generating'}
              className="text-left text-[13px] text-ink-2 underline decoration-rule underline-offset-4 hover:text-ink hover:decoration-ink">{ex}</button>
          ))}
        </div>
      </form>
      {error && <p role="alert" className="mt-3 text-[13px] text-vermilion">{error}</p>}
      {saved && <p role="status" className="mt-3 text-[13px] text-green">{saved}</p>}

      {phase === 'generating' && <Generating stage={stage} goal={goal} />}
      {phase === 'sheet' && draft && <Sheet coach={draft} onChange={setDraft} onActivate={() => activate(draft)} busy={busy} active={state.coach?.id === draft.id} />}

      <Library coaches={library} activeId={state.coach?.id ?? null} profile={profile} onOpen={(c) => { setDraft(c); setPhase('sheet'); setSaved(null); }}
        onActivate={activate} onPersonal={openPersonal} busy={busy} />
    </div>
  );
}

function Generating({ stage, goal }: { stage: number; goal: string }) {
  return (
    <section className="mt-8 grid gap-x-16 lg:grid-cols-[1fr_2fr]" aria-live="polite">
      <div>
        <div className="serif text-[34px] leading-none">Writing your coach</div>
        <p className="mt-3 max-w-[40ch] text-[13px] text-ink-2">From one sentence: “I want to {goal}”. The judge’s questions come first, then the rules that follow from them.</p>
      </div>
      <ol>
        {STAGES.map((s, i) => (
          <li key={s} className={`grid grid-cols-[40px_220px_1fr] items-center border-b border-rule py-3 transition-opacity duration-300 ${i < stage ? 'opacity-100' : i === stage ? 'opacity-70' : 'opacity-20'}`}>
            <span className="num text-ink-3">{String(i + 1).padStart(2, '0')}</span>
            <span className="serif text-[22px] leading-none">{s}</span>
            <span className="flex items-center gap-2">
              {i < stage ? <span className="caps !text-green">written</span> : i === stage ? <span className="caps caret !text-ink">writing</span> : null}
              {i < stage && <span className="h-px flex-1 bg-rule" />}
            </span>
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
      <div className="caps mb-2">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {values.map((v) => (
          <span key={v} className={`chip ${tone ? 'border-ochre' : ''}`}>{v}
            <button aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="text-ink-3 hover:text-vermilion">×</button>
          </span>
        ))}
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} onBlur={add}
          placeholder="add…" aria-label={`Add to ${label}`} className="field h-6 !w-24 text-[12px]" />
      </div>
    </div>
  );
}

function QuestionRow({ id, q }: { id: string; q: CoachQuestion }) {
  return (
    <li className="grid grid-cols-[76px_1fr] gap-x-4 border-b border-rule py-3">
      <span className="caps pt-0.5 !text-ink">{q.type === 'noul' ? 'yes / no' : q.type}</span>
      <div>
        <div className="num text-[12px] tracking-normal text-ink-2">{id}</div>
        <p className="text-[14px]">{q.instructions}</p>
        {q.type === 'choice' && <div className="mt-1.5 flex flex-wrap gap-1.5">{Object.keys(q.criteria).map((c) => <span key={c} className="chip" title={q.criteria[c]}>{c}</span>)}</div>}
        {q.type === 'score' && (
          <ol className="mt-1.5 flex gap-px">
            {q.criteria.map((c, i) => <li key={i} className="flex-1 border-t-2 border-ink pt-1 text-[11px] text-ink-2" style={{ borderTopWidth: 1 + i }}><span className="num mr-1 text-ink">{i + 1}</span>{c}</li>)}
          </ol>
        )}
      </div>
    </li>
  );
}

function RuleEditor({ rule, onChange, mode, isFocus }: { rule: NudgeRule; onChange: (r: NudgeRule) => void; mode: 'regular' | 'practice'; isFocus: boolean }) {
  const buzzes = mode === 'practice' ? rule.enabled !== false : isFocus;
  return (
    <li className="grid grid-cols-[minmax(0,1.1fr)_150px_minmax(0,1fr)_auto] items-center gap-x-4 border-b border-rule py-2.5">
      <code className="num truncate text-[12px] tracking-normal text-ink-2" title={rule.when}>{rule.when}</code>
      <span className="flex items-center gap-2">
        <span className="flex w-[64px] justify-start"><Glyph pattern={rule.haptic} size={18} playing playKey={rule.haptic} /></span>
        <select value={rule.haptic} onChange={(e) => onChange({ ...rule, haptic: e.target.value as HapticPattern })} aria-label={`Haptic for ${rule.id}`}
          className="field !w-auto cursor-pointer text-[12px]">
          {PATTERN_ORDER.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </span>
      <input value={rule.message} onChange={(e) => onChange({ ...rule, message: e.target.value })} aria-label={`Message for ${rule.id}`} className="field serif text-[20px] leading-none" />
      {mode === 'practice' ? (
        <label className="flex cursor-pointer items-center gap-2 text-[12px]">
          <input type="checkbox" checked={rule.enabled !== false} onChange={(e) => onChange({ ...rule, enabled: e.target.checked })} />
          {buzzes ? 'buzzes in drills' : 'off'}
        </label>
      ) : (
        <span className={`caps ${buzzes ? '!text-blue' : ''}`}>{buzzes ? 'the one buzz' : 'tracked quietly'}</span>
      )}
    </li>
  );
}

function Sheet({ coach, onChange, onActivate, busy, active }: { coach: CoachSpec; onChange: (c: CoachSpec) => void; onActivate: () => void; busy: boolean; active: boolean }) {
  const mode = coach.kind === 'personal' ? 'practice' : 'regular';
  const setRule = (list: 'nudge_rules' | 'motion_rules', i: number, r: NudgeRule) => onChange({ ...coach, [list]: coach[list].map((x, j) => (j === i ? r : x)) });
  const focus = coach.nudge_policy.focus_rule_id;
  return (
    <section className="anim-rise mt-8" aria-label="Coach sheet">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b-[3px] border-ink pb-3">
        <div className="min-w-0 flex-1">
          <div className="caps">{coach.kind} coach · {mode} mode</div>
          <input value={coach.name} onChange={(e) => onChange({ ...coach, name: e.target.value })} aria-label="Coach name" className="serif w-full border-0 bg-transparent text-[56px] leading-none outline-none focus:underline" />
        </div>
        <button className="btn btn-solid h-11 px-6 text-[15px]" onClick={onActivate} disabled={busy}>{active ? 'Active · save changes' : 'Activate this coach'}</button>
      </div>
      <textarea value={coach.goal} onChange={(e) => onChange({ ...coach, goal: e.target.value })} rows={2} aria-label="Goal" className="field mt-3 max-w-[90ch] resize-none text-[15px] text-ink-2" />

      <div className="mt-8 grid gap-x-14 gap-y-10 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div>
          <h2 className="caps border-b border-ink pb-2 !text-ink">{mode === 'regular' ? 'Rules · in a real conversation only pace buzzes' : 'Rules · which ones buzz during a drill'}</h2>
          <ul>
            {coach.nudge_rules.map((r, i) => <RuleEditor key={r.id} rule={r} mode={mode} isFocus={r.id === focus} onChange={(x) => setRule('nudge_rules', i, x)} />)}
            {coach.motion_rules.map((r, i) => <RuleEditor key={r.id} rule={r} mode={mode} isFocus={r.id === focus} onChange={(x) => setRule('motion_rules', i, x)} />)}
          </ul>
          <p className="mt-2 text-[12px] text-ink-3">
            {mode === 'regular'
              ? `Budget ${coach.nudge_policy.budget_per_session} buzzes a conversation, ${coach.nudge_policy.min_gap_s} s apart, only past ${Math.round(coach.nudge_policy.tolerance * 100)}% over your own pace.`
              : 'No cap inside a 30 to 90 second round. One “success” at most per round.'}
          </p>

          <h2 className="caps mt-9 border-b border-ink pb-2 !text-ink">What the judge asks after each of your turns</h2>
          <ul>{Object.entries(coach.questions).map(([id, q]) => <QuestionRow key={id} id={id} q={q} />)}</ul>
          {Object.keys(coach.questions).length === 0 && <p className="pt-3 text-[13px] text-ink-3">Only the ten core questions. This coach adds none of its own.</p>}
        </div>

        <div className="space-y-8">
          <div>
            <div className="flex items-baseline justify-between"><span className="caps">Sensitivity</span><span className="num text-[22px]">{coach.confidence_threshold.toFixed(2)}</span></div>
            <input type="range" min={0.5} max={0.95} step={0.01} value={coach.confidence_threshold} aria-label="Confidence threshold"
              onChange={(e) => onChange({ ...coach, confidence_threshold: Number(e.target.value) })} className="mt-1 w-full" />
            <div className="caps flex justify-between"><span>marks more</span><span>only when sure</span></div>
          </div>
          <Chips label={mode === 'practice' ? 'Your crutch words' : 'Filler words'} values={coach.filler_words} onChange={(v) => onChange({ ...coach, filler_words: v })} tone />
          <Chips label="Key terms for the transcriber" values={coach.keyterms} onChange={(v) => onChange({ ...coach, keyterms: v })} />
          <div>
            <div className="caps mb-1">Debrief rubric</div>
            <textarea value={coach.debrief_rubric} onChange={(e) => onChange({ ...coach, debrief_rubric: e.target.value })} rows={3} className="field resize-none text-[13.5px]" aria-label="Debrief rubric" />
          </div>
          <div>
            <div className="caps mb-1">Practice drills</div>
            <ol>{coach.drill.prompts.map((p, i) => (
              <li key={i} className="grid grid-cols-[22px_1fr] items-baseline border-b border-rule py-1.5">
                <span className="num text-[12px] text-ink-3">{i + 1}</span>
                <input value={p} aria-label={`Drill prompt ${i + 1}`} className="serif w-full border-0 bg-transparent text-[20px] outline-none focus:underline"
                  onChange={(e) => onChange({ ...coach, drill: { ...coach.drill, prompts: coach.drill.prompts.map((x, j) => (j === i ? e.target.value : x)) } })} />
              </li>
            ))}</ol>
            <p className="mt-2 text-[12px] text-ink-3">Partner: {coach.drill.partner_persona}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

const TREND = { better: 'getting better', same: 'steady', worse: 'rising' } as const;

function Library({ coaches, activeId, profile, onOpen, onActivate, onPersonal, busy }: {
  coaches: CoachSpec[]; activeId: string | null; profile: Fetched<HabitProfile> | null;
  onOpen: (c: CoachSpec) => void; onActivate: (c: CoachSpec) => void; onPersonal: () => void; busy: boolean;
}) {
  const others = coaches.filter((c) => c.kind !== 'personal');
  const p = profile?.ok ? profile.data : null;
  return (
    <section className="mt-14" aria-label="Coach library">
      <h2 className="caps border-b border-ink pb-2 !text-ink">Library</h2>
      <div className="grid gap-x-14 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <ul>
          {others.map((c) => (
            <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 border-b border-rule py-3">
              <button onClick={() => onOpen(c)} className="group min-w-0 text-left">
                <span className="serif text-[28px] leading-none group-hover:underline">{c.name}</span>
                <span className="caps ml-3">{c.kind}{c.id === activeId ? ' · active' : ''}</span>
                <span className="mt-1 block truncate text-[13px] text-ink-2">{c.goal}</span>
              </button>
              <button className={`btn ${c.id === activeId ? 'btn-quiet' : ''}`} disabled={busy || c.id === activeId} onClick={() => onActivate(c)}>{c.id === activeId ? 'Active' : 'Activate'}</button>
            </li>
          ))}
          {others.length === 0 && <li className="py-3 text-ink-3">No coaches yet.</li>}
        </ul>
        <div className="border-b border-rule py-3">
          <div className="flex items-baseline justify-between">
            <span><span className="serif text-[28px] leading-none">Personal</span><span className="caps ml-3">practice mode</span></span>
            <button className="btn" onClick={onPersonal}>Open</button>
          </div>
          <p className="mt-1 text-[13px] text-ink-2">{p ? `Built from your own last ${p.sessions} conversation${p.sessions === 1 ? '' : 's'}. It drills the words you lean on.` : 'Built from your own conversations. It drills the words you lean on.'}</p>
          {profile && !profile.ok && <p role="alert" className="mt-2 text-[13px] text-vermilion">{profile.error}</p>}
          {p && (
            <div className="mt-3 grid grid-cols-2 gap-x-8">
              <div>
                <div className="caps mb-1">Crutch words · per min</div>
                {p.crutch_words.map((w) => (
                  <div key={w.word} className="grid grid-cols-[1fr_auto] items-center gap-2 py-0.5">
                    <span className="relative"><span className="relative z-10 text-[14px]">{w.word}</span>
                      <span className="absolute inset-y-0 left-0 -z-0 bg-ochre/30" style={{ width: `${Math.min(100, (w.per_min / 3) * 100)}%` }} /></span>
                    <span className="num text-[13px]">{w.per_min.toFixed(1)}</span>
                  </div>
                ))}
                {p.crutch_words.length === 0 && <p className="text-[13px] text-ink-3">Not enough conversations yet.</p>}
              </div>
              <div>
                <div className="caps mb-1">Recurring</div>
                {p.recurring_issues.map((r) => (
                  <div key={r.rule_id} className="flex justify-between gap-3 py-0.5 text-[13px]"><span>{r.label}</span><span className="caps shrink-0">{TREND[r.trend]}</span></div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-ink-3">
        <span className="caps">Vocabulary</span>
        {PATTERN_ORDER.slice(0, 6).map((pt) => <span key={pt} className="flex items-center gap-1.5"><Glyph pattern={pt} size={12} />{PATTERNS[pt].action.toLowerCase()}</span>)}
      </p>
    </section>
  );
}
