import { redirect } from 'next/navigation';
import { settingsHref } from '@/components/settings/redirect';

/** Calibration lives in Settings, in its own section. */
export default async function CalibrationPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(settingsHref('calibration', await searchParams));
}
