'use client';

import { Headphones, Mic } from 'lucide-react';
import { Button, ICON, Panel, Section, SkeletonLines } from '@/components/ui';
import type { Fetched } from '@/lib/api/results';
import type { PracticeGoals } from '@/lib/practice/model';
import { GoalItem } from './result-goals';
import { VoiceOrb } from './voice-orb';

export interface PracticeBeforeProps {
  coachName: string | null;
  goals: Fetched<PracticeGoals> | null;
  /** False on an address where the browser will not open the microphone. */
  micOk: boolean;
  connecting: boolean;
  onStart(): void;
}

const STEPS = [
  { title: 'Your coach asks', body: 'About five spoken questions, one at a time.' },
  { title: 'You answer out loud', body: 'Take your time. You can start talking while the coach is still speaking.' },
  { title: 'You get a score and goals', body: 'How each part went, and what to work on next time.' },
] as const;

/** Before a practice: what will happen, last time's goals, and Start. */
export function PracticeBefore({ coachName, goals, micOk, connecting, onStart }: PracticeBeforeProps) {
  const who = coachName ?? 'Your coach';
  return (
    <div className="pr-before">
      <Panel className="pr-stage" padding="none">
        <span className="pr-stage-light" aria-hidden />
        <div className="pr-stage-body">
          <VoiceOrb speaker={connecting ? 'thinking' : 'idle'} size="md" />
          <div className="min-w-0">
            <p className="pr-stage-kicker">{connecting ? `Connecting you to ${who}…` : `${who} is ready when you are`}</p>
            <h2 className="pr-stage-title">A five-minute spoken practice</h2>
            <ol className="pr-steps">
              {STEPS.map((s, i) => (
                <li key={s.title} className="pr-step">
                  <span className="pr-step-num" aria-hidden>{i + 1}</span>
                  <span><b className="font-medium text-fg">{s.title}.</b> <span className="text-muted">{s.body}</span></span>
                </li>
              ))}
            </ol>
            <p className="pr-note"><Headphones {...ICON} size={16} aria-hidden />Headphones help, so the coach doesn’t hear itself.</p>
            {micOk ? (
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button variant="primary" onClick={onStart} loading={connecting}><Mic {...ICON} size={16} aria-hidden />Start practice</Button>
                <span className="text-caption text-muted">Your browser will ask to use the microphone.</span>
              </div>
            ) : (
              <p className="pr-alert mt-6" role="status">The microphone only works on this laptop’s own address (localhost) or over https.</p>
            )}
          </div>
        </div>
      </Panel>
      <ThisTime goals={goals} />
    </div>
  );
}

function ThisTime({ goals }: { goals: Fetched<PracticeGoals> | null }) {
  if (goals === null) {
    return <Section title="This time, work on"><Panel tone="coach"><SkeletonLines lines={3} label="Loading your goals" /></Panel></Section>;
  }
  if (!goals.ok) {
    return <Section title="This time, work on"><Panel><p className="text-body text-muted">{goals.error}</p></Panel></Section>;
  }
  if (goals.data.goals.length === 0) {
    return (
      <Section title="This time, work on">
        <Panel tone="coach">
          <p className="font-voice text-lead text-fg/90">After your first practice, the goals your coach sets for you show up here.</p>
        </Panel>
      </Section>
    );
  }
  return (
    <Section title="This time, work on">
      <Panel tone="coach">
        <ul className="pr-goals">{goals.data.goals.map((g) => <GoalItem key={`${g.measure}-${g.title}`} goal={g} />)}</ul>
      </Panel>
    </Section>
  );
}
