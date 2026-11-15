import { redirect } from 'next/navigation';
import { withQuery } from '@/components/coach/redirect';

/** Rehearsing happens on the Live page. */
export default async function RehearsePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(withQuery('/live', await searchParams));
}
