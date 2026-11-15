'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getPracticeGoals, listPracticeResults } from '@/lib/api/practice';
import type { Fetched } from '@/lib/api/results';
import type { PracticeGoals, PracticeResultSummary } from '@/lib/practice/model';

export interface PracticeData {
  /** null while loading. */
  goals: Fetched<PracticeGoals> | null;
  results: Fetched<PracticeResultSummary[]> | null;
  /** Stable: load both again (after a new result). */
  reload(): void;
}

/** The latest goals and past practices, loaded on mount and on demand. */
export function usePracticeData(): PracticeData {
  const [goals, setGoals] = useState<Fetched<PracticeGoals> | null>(null);
  const [results, setResults] = useState<Fetched<PracticeResultSummary[]> | null>(null);
  const mounted = useRef(true);

  const reload = useCallback(() => {
    void getPracticeGoals().then((g) => { if (mounted.current) setGoals(g); });
    void listPracticeResults().then((r) => { if (mounted.current) setResults(r); });
  }, []);

  useEffect(() => {
    mounted.current = true;
    reload();
    return () => { mounted.current = false; };
  }, [reload]);

  return { goals, results, reload };
}
