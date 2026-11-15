import { redirect } from 'next/navigation';
import { withQuery } from '@/components/coach/redirect';

/** The old Studio is now the Coach page. */
export default async function StudioPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(withQuery('/coach', await searchParams));
}
