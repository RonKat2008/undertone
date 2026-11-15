import { redirect } from 'next/navigation';
import { settingsHref } from '@/components/settings/redirect';

/** Pairing lives in Settings now. */
export default async function PairPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(settingsHref('phone', await searchParams));
}
