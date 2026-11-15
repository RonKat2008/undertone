'use client';

import { RotateCcw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, EmptyState, ICON, Page, Panel, Skeleton } from '@/components/ui';
import { getPracticeResult } from '@/lib/api/practice';
import type { RecordResult } from '@/lib/api/results';
import { useBus } from '@/lib/bus/use-bus';
import type { PracticeResult } from '@/lib/practice/model';
import { failureWords } from '@/lib/practice/session';
import { micAvailable } from './audio-engine';
import { PracticeBefore } from './before';
import { PracticeLive } from './live';
import { PastResults } from './past-results';
import { ResultView } from './result-view';
import { usePracticeData } from './use-practice-data';
import { usePracticeSession } from './use-practice-session';
import './practice.css';

const TITLE = 'Practice with your coach';
const LEDE = 'Your coach asks, you answer out loud, and you get a score and goals for next time.';

/** /coach/practice: a spoken practice, or (with ?result=) one past result. */
export function PracticeScreen({ resultId }: { resultId: string | null }) {
  if (resultId) return <PastResultScreen key={resultId} id={resultId} />;
  return <SessionScreen />;
}

function SessionScreen() {
  const { session, start, end, reset, level } = usePracticeSession();
  const data = usePracticeData();
  const { state } = useBus();
  const [micOk, setMicOk] = useState(true);
  const { phase } = session;
  const { reload } = data;

  useEffect(() => setMicOk(micAvailable()), []);
  useEffect(() => {
    if (phase === 'result' || phase === 'no_result') reload();
  }, [phase, reload]);

  const coachName = session.coachName ?? state.coach?.name ?? null;
  const again = <Button variant="primary" onClick={start}><RotateCcw {...ICON} size={16} aria-hidden />Practice again</Button>;

  return (
    <Page title={TITLE} lede={LEDE}>
      <div className="pr-flow">
        {phase === 'before' || phase === 'connecting' ? (
          <PracticeBefore coachName={coachName} goals={data.goals} micOk={micOk} connecting={phase === 'connecting'} onStart={start} />
        ) : null}
        {phase === 'live' || phase === 'scoring' ? <PracticeLive session={session} level={level} onEnd={end} /> : null}
        {phase === 'result' && session.result ? <ResultView result={session.result} action={again} /> : null}
        {phase === 'no_result' ? (
          <Panel>
            <EmptyState mark="idle" action={<Button variant="primary" onClick={start}>Try again</Button>}>
              {session.noResult ?? 'There was nothing to score this time.'}
            </EmptyState>
          </Panel>
        ) : null}
        {phase === 'error' && session.failure ? (
          <Panel>
            <EmptyState mark="offline" action={<div className="flex flex-wrap justify-center gap-3">
              <Button variant="primary" onClick={start}>Try again</Button>
              <Button variant="ghost" onClick={reset}>Back</Button>
            </div>}>
              {failureWords(session.failure, session.address)}
            </EmptyState>
          </Panel>
        ) : null}
        {phase !== 'live' && phase !== 'scoring' ? <PastResults results={data.results} currentId={session.result?.id ?? null} /> : null}
      </div>
    </Page>
  );
}

function PastResultScreen({ id }: { id: string }) {
  const [record, setRecord] = useState<RecordResult<PracticeResult> | null>(null);
  const data = usePracticeData();

  useEffect(() => {
    let live = true;
    void getPracticeResult(id).then((r) => { if (live) setRecord(r); });
    return () => { live = false; };
  }, [id]);

  const again = <Button variant="primary" href="/coach/practice"><RotateCcw {...ICON} size={16} aria-hidden />Practice again</Button>;
  return (
    <Page title={TITLE} lede={LEDE}>
      <div className="pr-flow">
        {record === null ? (
          <Panel><div className="grid gap-3" role="status" aria-label="Loading this practice">
            <Skeleton shape="block" height={180} /><Skeleton width="60%" /><Skeleton width="80%" />
          </div></Panel>
        ) : null}
        {record?.kind === 'ok' ? <ResultView result={record.data} action={again} /> : null}
        {record?.kind === 'not_found' ? (
          <Panel><EmptyState mark="idle" action={again}>This practice isn’t there any more.</EmptyState></Panel>
        ) : null}
        {record?.kind === 'error' ? (
          <Panel><EmptyState mark="offline" action={again}>{record.message}</EmptyState></Panel>
        ) : null}
        <PastResults results={data.results} currentId={id} />
      </div>
    </Page>
  );
}
