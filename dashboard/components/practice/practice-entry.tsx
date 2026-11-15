'use client';

import { ArrowRight, Mic, Target } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ICON } from '@/components/ui';
import { getPracticeGoals } from '@/lib/api/practice';
import type { Fetched } from '@/lib/api/results';
import { clampScore, dayWords, scoreBand, scoreWords, type PracticeGoals } from '@/lib/practice/model';
import { VoiceOrb } from './voice-orb';
import './practice.css';

const SHOWN_GOALS = 3;

/** The Coach page's way in to spoken practice: the current goals and the last score, when there is one. */
export function PracticeEntry({ coachName }: { coachName: string | null }) {
  const [goals, setGoals] = useState<Fetched<PracticeGoals> | null>(null);
  const [now] = useState(() => Date.now());

  useEffect(() => {
    let live = true;
    void getPracticeGoals().then((g) => { if (live) setGoals(g); });
    return () => { live = false; };
  }, []);

  const data = goals?.ok ? goals.data : null;
  const last = data && data.overall !== null ? Math.round(clampScore(data.overall)) : null;
  const when = data?.started_at ? dayWords(data.started_at, now) : '';
  return (
    <Link href="/coach/practice" className="pr-entry qi-panel" data-tone="default" data-padding="none">
      <span className="pr-stage-light" aria-hidden />
      <div className="pr-entry-body">
        <VoiceOrb speaker="idle" size="md" />
        <div className="min-w-0 flex-1">
          <p className="pr-stage-kicker">{coachName ? `${coachName} asks, you answer out loud` : 'Your coach asks, you answer out loud'}</p>
          <h2 className="pr-entry-title">Practice with your coach</h2>
          <p className="text-body text-muted text-pretty">About five questions and five minutes, then a score and goals for next time.</p>
          {data && data.goals.length > 0 ? (
            <ul className="pr-entry-goals" aria-label="Your current goals">
              {data.goals.slice(0, SHOWN_GOALS).map((g) => (
                <li key={`${g.measure}-${g.title}`}><Target {...ICON} size={14} aria-hidden />{g.title}</li>
              ))}
            </ul>
          ) : null}
          <span className="pr-entry-cta"><Mic {...ICON} size={16} aria-hidden />Start a practice<ArrowRight {...ICON} size={16} aria-hidden /></span>
        </div>
        {last !== null ? (
          <div className="pr-entry-last" data-band={scoreBand(last)}>
            <span className="pr-entry-last-num tabular">{last}</span>
            <span className="text-caption text-muted">{when ? `Last score, ${when.toLowerCase()}` : 'Last score'}</span>
            <span className="text-caption text-fg/80">{scoreWords(last)}</span>
          </div>
        ) : null}
      </div>
    </Link>
  );
}
