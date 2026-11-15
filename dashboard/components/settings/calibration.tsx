'use client';

import { animate, createScope, type Scope } from 'animejs';
import { Check } from 'lucide-react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, ICON } from '@/components/ui';
import { calibrateMotion, swapSpeakers } from '@/lib/api/client';
import { MOTION_PHASES, motionPhase, PHASE_SECONDS, plainError } from '@/lib/api/settings-model';
import { motionPresets, prefersReducedMotion } from '@/lib/motion';

type Outcome = { kind: 'idle' } | { kind: 'busy' } | { kind: 'done' } | { kind: 'error'; message: string };

const TICK_MS = 200;

/** The two calibration steps as guided actions, each with an honest result. */
export function Calibration() {
  return (
    <div className="grid gap-6 pt-2">
      <MotionStep />
      <SwapStep />
    </div>
  );
}

function StepHead({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-3">
      <span aria-hidden className="grid size-7 place-items-center rounded-full bg-[var(--coach-wash)] text-caption font-medium text-coach tabular">{n}</span>
      <div className="min-w-0 pt-0.5">
        <h3 className="text-body font-medium text-fg">{title}</h3>
        <p className="mt-0.5 text-body text-muted text-pretty">{children}</p>
      </div>
    </div>
  );
}

function Result({ outcome, success }: { outcome: Outcome; success: string }) {
  if (outcome.kind === 'done') {
    return (
      <p role="status" className="inline-flex items-center gap-2 text-body text-accent">
        <Check {...ICON} size={16} aria-hidden />{success}
      </p>
    );
  }
  if (outcome.kind === 'error') return <p role="alert" className="text-body text-danger">{outcome.message}</p>;
  return null;
}

function MotionStep() {
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (startedAt === null) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [startedAt]);

  async function start() {
    const t = Date.now();
    setStartedAt(t);
    setNow(t);
    setOutcome({ kind: 'busy' });
    try {
      await calibrateMotion();
      setOutcome({ kind: 'done' });
    } catch (e) {
      setOutcome({ kind: 'error', message: `Movement wasn’t saved. ${plainError(e)}` });
    } finally {
      setStartedAt(null);
    }
  }

  const running = outcome.kind === 'busy' && startedAt !== null;
  return (
    <div className="grid gap-4">
      <StepHead n={1} title="Teach it your movement">
        Fifteen seconds: hold still, talk with your hands, then fidget. Undertone learns what each looks like on your wrist.
      </StepHead>
      <div className="pl-10">
        {running ? (
          <Countdown elapsed={Math.max(0, now - startedAt)} />
        ) : (
          <div className="grid justify-items-start gap-3">
            <Result outcome={outcome} success="Saved. Undertone now knows how your hands move." />
            <Button size="small" onClick={() => void start()}>{outcome.kind === 'done' ? 'Teach it again' : 'Start'}</Button>
          </div>
        )}
      </div>
    </div>
  );
}

/** One bar per phase; the current one fills over its five seconds (anime.js), with a big seconds count. */
function Countdown({ elapsed }: { elapsed: number }) {
  const reduced = useReducedMotion() ?? false;
  const presets = motionPresets(reduced);
  const { index, secondsLeft, finishing } = motionPhase(elapsed);
  const phase = MOTION_PHASES[index];
  const bars = useRef<HTMLDivElement>(null);
  const scope = useRef<Scope | null>(null);
  const startedPhaseAt = useRef(elapsed);

  useEffect(() => {
    startedPhaseAt.current = elapsed;
    // only when the phase changes: elapsed is read once to resume mid-phase
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  useEffect(() => {
    if (!bars.current || finishing || prefersReducedMotion()) return;
    const remaining = Math.max(0, PHASE_SECONDS * 1000 * (index + 1) - startedPhaseAt.current);
    const from = 1 - remaining / (PHASE_SECONDS * 1000);
    scope.current = createScope({ root: bars.current }).add(() => {
      animate(`[data-bar="${index}"] > span`, { scaleX: [from, 1], duration: remaining, ease: 'linear' });
    });
    return () => scope.current?.revert();
  }, [index, finishing]);

  return (
    <div className="grid gap-4" role="timer" aria-live="polite">
      <div ref={bars} className="grid grid-cols-3 gap-2" aria-hidden>
        {MOTION_PHASES.map((p, i) => (
          <div key={p.id} data-bar={i} className="settings-phase-bar" data-state={i < index || finishing ? 'done' : i === index ? 'now' : 'next'}>
            <span />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-5">
        <span className="grid size-16 shrink-0 place-items-center rounded-full bg-[var(--accent-wash)] text-[28px] font-medium leading-none text-accent tabular">
          <AnimatePresence mode="popLayout" initial={false}>
            <m.span key={finishing ? 'done' : `${index}-${secondsLeft}`} variants={presets.fade} initial="hidden" animate="shown" exit="gone">
              {finishing ? '…' : secondsLeft}
            </m.span>
          </AnimatePresence>
        </span>
        <AnimatePresence mode="wait" initial={false}>
          <m.div key={finishing ? 'saving' : phase.id} variants={presets.enter} initial="hidden" animate="shown" exit="gone" className="min-w-0">
            <p className="text-lead font-medium text-fg">{finishing ? 'Saving' : phase.title}</p>
            <p className="text-body text-muted">{finishing ? 'Working out your thresholds.' : `${phase.hint} Step ${index + 1} of 3.`}</p>
          </m.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function SwapStep() {
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });
  async function swap() {
    setOutcome({ kind: 'busy' });
    try {
      await swapSpeakers();
      setOutcome({ kind: 'done' });
    } catch (e) {
      setOutcome({ kind: 'error', message: `Nothing was swapped. ${plainError(e)}` });
    }
  }
  return (
    <div className="grid gap-4">
      <StepHead n={2} title="Swap who is who">
        If your words show up as the other person’s, swap the two voices. You can do this mid-conversation.
      </StepHead>
      <div className="grid justify-items-start gap-3 pl-10">
        <Result outcome={outcome} success="Swapped. From now on the two voices are labelled the other way round." />
        <Button size="small" loading={outcome.kind === 'busy'} onClick={() => void swap()}>Swap voices</Button>
      </div>
    </div>
  );
}
