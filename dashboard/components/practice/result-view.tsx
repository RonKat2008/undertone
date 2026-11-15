'use client';

import { Feather, Sparkle } from 'lucide-react';
import { m } from 'motion/react';
import { useState, type ReactNode } from 'react';
import { ICON, Panel, Section } from '@/components/ui';
import { motionPresets } from '@/lib/motion';
import {
  clampScore, dayWords, durationWords, fromAnswerWords, scoreBand, sourceWords,
  type PracticeResult, type PracticeStrength, type PracticeSubScore,
} from '@/lib/practice/model';
import { useReducedMotion } from '@/lib/use-reduced-motion';
import { GoalChecks, NextGoals } from './result-goals';
import { ScoreRing } from './score-ring';

export interface ResultViewProps {
  result: PracticeResult;
  /** One action under the score, e.g. "Practice again". */
  action?: ReactNode;
}

/** After a practice: the score, the coach's summary, sub-scores, strengths and goals for next time. */
export function ResultView({ result, action }: ResultViewProps) {
  const reduced = useReducedMotion();
  const p = motionPresets(reduced);
  return (
    <m.div className="pr-result" initial="hidden" animate="shown" variants={p.list}>
      <m.div variants={p.enter}>
        <ScoreHero result={result} action={action} />
      </m.div>
      {result.sub_scores.length > 0 ? (
        <m.div variants={p.enter}>
          <Section title="How each part went">
            <Panel>
              <ul className="pr-bars">
                {result.sub_scores.map((s) => <SubScoreBar key={s.measure} sub={s} />)}
              </ul>
            </Panel>
          </Section>
        </m.div>
      ) : null}
      {result.strengths.length > 0 ? (
        <m.div variants={p.enter}>
          <Section title="What went well" icon={<Sparkle {...ICON} size={16} aria-hidden className="text-accent" />}>
            <Strengths items={result.strengths.slice(0, 3)} />
          </Section>
        </m.div>
      ) : null}
      <m.div variants={p.enter}>
        <NextGoals goals={result.goals} />
      </m.div>
      {result.previous_goals.length > 0 ? (
        <m.div variants={p.enter}>
          <GoalChecks checks={result.previous_goals} />
        </m.div>
      ) : null}
    </m.div>
  );
}

function ScoreHero({ result, action }: ResultViewProps) {
  const [now] = useState(() => Date.now());
  const when = dayWords(result.started_at, now);
  const answers = result.answers.length;
  const meta = [when, `with ${result.coach_name}`, durationWords(result.duration_s), answers === 1 ? '1 answer' : `${answers} answers`]
    .filter(Boolean).join(' · ');
  return (
    <Panel className="pr-hero" padding="none">
      <span className="pr-hero-light" aria-hidden />
      <div className="pr-hero-body">
        <ScoreRing score={result.overall} />
        <div className="pr-hero-text">
          <p className="pr-hero-from"><Feather {...ICON} size={16} aria-hidden />{result.coach_name} says</p>
          <p className="pr-hero-summary">{result.summary}</p>
          <p className="text-caption text-muted mt-3">{meta}</p>
          {result.ended_early ? <p className="text-caption text-muted">You ended early, so only the answers you gave were scored.</p> : null}
          {action ? <div className="mt-5 flex flex-wrap gap-3">{action}</div> : null}
        </div>
      </div>
    </Panel>
  );
}

function SubScoreBar({ sub }: { sub: PracticeSubScore }) {
  const score = Math.round(clampScore(sub.score));
  return (
    <li className="pr-bar" data-band={scoreBand(score)}>
      <div className="pr-bar-head">
        <span className="pr-bar-label">{sub.label}</span>
        <span className="pr-bar-score tabular">{score}</span>
      </div>
      <div className="pr-bar-track" role="img" aria-label={`${sub.label}: ${score} out of 100`}>
        <span className="pr-bar-fill" style={{ transform: `scaleX(${score / 100})` }} />
      </div>
      <div className="pr-bar-foot">
        <span className="text-body text-fg/90">{sub.detail}</span>
        <span className="pr-bar-source" data-source={sub.source}>{sourceWords(sub.source)}</span>
      </div>
    </li>
  );
}

function Strengths({ items }: { items: PracticeStrength[] }) {
  return (
    <ul className="pr-strengths">
      {items.map((s, i) => {
        const from = fromAnswerWords(s.from_answer);
        return (
          <li key={`${s.title}-${i}`} className="pr-strength">
            <span className="pr-strength-mark" aria-hidden><Sparkle {...ICON} size={16} /></span>
            <div className="min-w-0">
              <p className="text-body font-medium text-fg">{s.title}</p>
              <p className="text-body text-muted text-pretty">{s.detail}</p>
              {from ? <p className="text-caption text-muted mt-1">{from}</p> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
