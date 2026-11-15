import type { Metadata } from 'next';
import { PracticeScreen } from '@/components/practice/practice-screen';

export const metadata: Metadata = { title: 'Practice · Undertone' };

/** A spoken practice with the active coach; `?result=<id>` shows one past result. */
export default async function PracticePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = (await searchParams).result;
  const result = typeof raw === 'string' && raw.length > 0 && raw.length <= 200 ? raw : null;
  return <PracticeScreen resultId={result} />;
}
