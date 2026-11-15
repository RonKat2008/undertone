'use client';

import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { Sparkles, UserRound } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, ICON, ListeningMark, Panel, Textarea } from '@/components/ui';
import { buildCoach, buildPersonalCoach } from '@/lib/api/client';
import { goalSentence, listensFor } from '@/lib/api/coach';
import type { CoachSpec } from '@/lib/bus/contracts';
import { motionPresets } from '@/lib/motion';
import { ListenLines } from './listen-lines';

const EXAMPLES = [
  'Stop saying “like” and sound confident in interviews',
  'Listen more than I talk when a friend is upset',
  'Pitch my idea in ninety seconds without rushing',
];

/** The builder's own limit on a goal (backend/studio/routes.py). */
const MAX_GOAL = 400;

type Phase =
  | { kind: 'idle' }
  | { kind: 'building'; goal: string; personal: boolean; startedAt: number }
  | { kind: 'preview'; spec: CoachSpec; fallback: boolean; personal: boolean };

export interface BuildCoachProps {
  /** Offer "Build one from my own habits". */
  canPersonal: boolean;
  /** Save and activate the previewed coach. Resolves when done. */
  onUse: (spec: CoachSpec) => Promise<void>;
  /** A coach was built (the backend keeps it); refresh the list. */
  onBuilt: () => void;
}

/** One sentence in, a coach out: the goal field, a calm wait, then a plain preview. */
export function BuildCoach({ canPersonal, onUse, onBuilt }: BuildCoachProps) {
  const reduced = useReducedMotion() ?? false;
  const presets = motionPresets(reduced);
  const [goal, setGoal] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function build(text: string) {
    const clean = text.trim();
    if (!clean) { setError('Write one sentence about what you want to get better at.'); return; }
    if (clean.length > MAX_GOAL) { setError(`Keep it to ${MAX_GOAL} characters or fewer.`); return; }
    setError(null);
    setPhase({ kind: 'building', goal: clean, personal: false, startedAt: Date.now() });
    try {
      const built = await buildCoach(clean);
      setPhase({ kind: 'preview', spec: built.spec, fallback: built.source === 'fallback', personal: false });
      onBuilt();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The coach could not be built.');
      setPhase({ kind: 'idle' });
    }
  }

  async function buildPersonal() {
    setError(null);
    setPhase({ kind: 'building', goal: 'Your own habits', personal: true, startedAt: Date.now() });
    try {
      const spec = await buildPersonalCoach();
      setPhase({ kind: 'preview', spec, fallback: false, personal: true });
      onBuilt();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The coach could not be built.');
      setPhase({ kind: 'idle' });
    }
  }

  async function use(spec: CoachSpec) {
    setSaving(true);
    try {
      await onUse(spec);
      setPhase({ kind: 'idle' });
      setGoal('');
    } catch {
      /* the page already said what failed; keep the preview so it can be tried again */
    } finally {
      setSaving(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void build(goal);
  }

  return (
    <Panel>
      <AnimatePresence mode="wait" initial={false}>
        {phase.kind === 'idle' && (
          <m.div key="idle" variants={presets.fade} initial="hidden" animate="shown" exit="gone">
            <form onSubmit={submit} className="grid gap-4">
              <Textarea label="Describe what you want to get better at in one sentence" value={goal} rows={2} maxLength={MAX_GOAL}
                onChange={(e) => { setGoal(e.target.value); if (error) setError(null); }} error={error ?? undefined}
                placeholder="I want to…" autoComplete="off"
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void build(goal); } }} />
              <div className="flex flex-wrap gap-2" aria-label="Examples">
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" onClick={() => setGoal(ex)}
                    className="text-caption min-h-11 rounded-full px-3 text-left text-muted transition-[background-color,color,transform] duration-150 hover:bg-[var(--hover)] hover:text-fg active:scale-[0.97] sm:min-h-8 bg-[color-mix(in_oklch,var(--text)_5%,transparent)]">
                    {ex}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="primary"><Sparkles {...ICON} size={16} aria-hidden />Build coach</Button>
                {canPersonal && (
                  <Button variant="ghost" onClick={() => void buildPersonal()}><UserRound {...ICON} size={16} aria-hidden />Build one from my own habits</Button>
                )}
              </div>
            </form>
          </m.div>
        )}
        {phase.kind === 'building' && (
          <m.div key="building" variants={presets.fade} initial="hidden" animate="shown" exit="gone">
            <Building goal={phase.goal} personal={phase.personal} startedAt={phase.startedAt} />
          </m.div>
        )}
        {phase.kind === 'preview' && (
          <m.div key="preview" variants={presets.enter} initial="hidden" animate="shown" exit="gone">
            <Preview spec={phase.spec} fallback={phase.fallback} personal={phase.personal} saving={saving}
              onUse={() => void use(phase.spec)} onDiscard={() => setPhase({ kind: 'idle' })} />
          </m.div>
        )}
      </AnimatePresence>
    </Panel>
  );
}

function Building({ goal, personal, startedAt }: { goal: string; personal: boolean; startedAt: number }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.round((now - startedAt) / 1000));
  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center" role="status" aria-live="polite">
      <ListeningMark state="listening" size="lg" />
      <div className="grid gap-2">
        <p className="text-lead font-medium text-fg">{personal ? 'Building a coach from your habits' : 'Writing your coach'}</p>
        {!personal && <p className="font-voice text-lead text-coach text-balance">“{goal}”</p>}
        <p className="text-body max-w-[46ch] text-pretty text-muted">
          {personal
            ? 'It looks at the words you lean on and the habits that keep coming up.'
            : 'It decides what to listen for and which words your phone will show. This usually takes under a minute.'}
        </p>
        <p className="text-caption tabular text-muted" aria-hidden>{seconds > 2 ? `${seconds} seconds so far` : ' '}</p>
      </div>
    </div>
  );
}

function Preview({ spec, fallback, personal, saving, onUse, onDiscard }: {
  spec: CoachSpec; fallback: boolean; personal: boolean; saving: boolean; onUse: () => void; onDiscard: () => void;
}) {
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <p className="text-caption text-coach">{personal ? 'Built from your own habits' : 'Your new coach'}</p>
        <h3 className="text-title text-fg text-balance">{spec.name}</h3>
        <p className="text-body text-pretty text-muted">{goalSentence(spec.goal)}</p>
      </div>
      {fallback && (
        <p className="text-body rounded-control bg-[var(--coach-wash)] px-4 py-3 text-fg" role="note">
          The builder could not reach its model, so this is a basic template. You can use it, or try again later.
        </p>
      )}
      <div>
        <p className="text-body mb-2 font-medium text-fg">What it will listen for</p>
        <ListenLines lines={listensFor(spec)} />
      </div>
      <div className="flex flex-wrap gap-3">
        <Button variant="primary" loading={saving} onClick={onUse}>Use this coach</Button>
        <Button variant="ghost" onClick={onDiscard} disabled={saving}>Discard</Button>
      </div>
    </div>
  );
}
