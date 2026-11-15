import type { Metadata } from 'next';
import { CoachScreen } from '@/components/coach/coach-screen';

export const metadata: Metadata = { title: 'Coach · Undertone' };

/** Your coach, what it listens for, switching and building coaches, and your habits. */
export default function CoachPage() {
  return <CoachScreen />;
}
