'use client';

import { History } from 'lucide-react';
import { useState } from 'react';
import { ICON, List, ListRow, Panel, Section, SkeletonLines, Sparkline } from '@/components/ui';
import type { Fetched } from '@/lib/api/results';
import {
  clampScore, dayWords, durationWords, goalsMetWords, scoreBand, trendDomain, trendValues, trendWords, type PracticeResultSummary,
} from '@/lib/practice/model';

export interface PastResultsProps {
  results: Fetched<PracticeResultSummary[]> | null;
  /** The result on screen, marked as current. */
  currentId?: string | null;
}

/** Earlier practices, newest first, with the trend of overall scores. */
export function PastResults({ results, currentId = null }: PastResultsProps) {
  const [now] = useState(() => Date.now());
  if (results === null) {
    return <Section title="Past practices"><Panel><SkeletonLines lines={3} label="Loading past practices" /></Panel></Section>;
  }
  if (!results.ok) {
    return <Section title="Past practices"><Panel><p className="text-body text-muted">{results.error}</p></Panel></Section>;
  }
  if (results.data.length === 0) return null;
  const values = trendValues(results.data);
  return (
    <Section title="Past practices" icon={<History {...ICON} size={16} aria-hidden />}
      aside={values.length >= 2 ? <Sparkline values={values} label={trendWords(values)} width={120} height={28} domain={trendDomain(values)} /> : null}>
      <Panel padding="list">
        <List label="Past practices">
          {results.data.map((r) => {
            const met = goalsMetWords(r);
            const meta = [durationWords(r.duration_s), r.answers === 1 ? '1 answer' : `${r.answers} answers`, met].filter(Boolean).join(' · ');
            const score = Math.round(clampScore(r.overall));
            return (
              <ListRow key={r.id} href={`/coach/practice?result=${encodeURIComponent(r.id)}`} current={r.id === currentId}
                title={`${dayWords(r.started_at, now) || 'Practice'} with ${r.coach_name}`} meta={meta}
                trailing={<span className="pr-chip tabular" data-band={scoreBand(score)} aria-label={`Score ${score}`}>{score}</span>} />
            );
          })}
        </List>
      </Panel>
    </Section>
  );
}
