'use client';

import { Square } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { Button, ICON, Panel } from '@/components/ui';
import { motionPresets } from '@/lib/motion';
import { questionWords } from '@/lib/practice/model';
import { speakerWords, type Caption, type PracticeSession } from '@/lib/practice/session';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { VoiceOrb } from './voice-orb';

export interface PracticeLiveProps {
  session: PracticeSession;
  level(who: 'coach' | 'you'): number;
  onEnd(): void;
}

const SHOWN_CAPTIONS = 4;

/** During a practice: who is speaking, the coach's question, live captions, and End. */
export function PracticeLive({ session, level, onEnd }: PracticeLiveProps) {
  const reduced = useReducedMotion();
  const p = motionPresets(reduced);
  const scoring = session.phase === 'scoring' || session.ending;
  const speaker = scoring ? 'thinking' : session.speaker;
  const status = scoring ? `${session.coachName ?? 'Your coach'} is scoring your answers…` : speakerWords(session.speaker, session.coachName);
  return (
    <Panel className="pr-live" padding="none" as="section">
      <span className="pr-live-light" data-speaker={speaker} aria-hidden />
      <div className="pr-live-body">
        <div className="pr-live-top">
          <span className="pr-live-who" data-speaker={speaker} role="status">{status}</span>
          <span className="pr-live-count tabular">{questionWords(session.question, session.planned)}</span>
        </div>
        <div className="pr-live-center">
          <VoiceOrb speaker={speaker} level={level} />
          <AnimatePresence mode="wait" initial={false}>
            <m.p key={session.coachLine ?? 'none'} className="pr-question" variants={p.fade} initial="hidden" animate="shown" exit="gone"
              aria-live="polite">
              {session.coachLine ?? `${session.coachName ?? 'Your coach'} will ask the first question in a moment.`}
            </m.p>
          </AnimatePresence>
          {session.warning ? <p className="pr-alert" role="status">{session.warning}</p> : null}
        </div>
        <Captions captions={session.captions.slice(-SHOWN_CAPTIONS)} coachName={session.coachName} />
        <div className="pr-live-actions">
          <Button variant="quiet" onClick={onEnd} loading={session.ending && session.phase !== 'scoring'} disabled={scoring}>
            <Square {...ICON} size={14} aria-hidden />{scoring ? 'Scoring…' : 'End and get my score'}
          </Button>
          {!scoring ? <span className="text-caption text-muted">Your answers so far are scored.</span> : null}
        </div>
      </div>
    </Panel>
  );
}

function Captions({ captions, coachName }: { captions: Caption[]; coachName: string | null }) {
  if (captions.length === 0) return null;
  return (
    <ol className="pr-captions" aria-label="Captions">
      {captions.map((c) => (
        <li key={c.key} className="pr-caption" data-role={c.role}>
          <span className="pr-caption-who">{c.role === 'coach' ? coachName ?? 'Coach' : 'You'}</span>
          <span className="pr-caption-text">{c.text}</span>
        </li>
      ))}
    </ol>
  );
}
