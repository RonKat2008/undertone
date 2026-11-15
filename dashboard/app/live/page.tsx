import type { Metadata } from 'next';
import { LiveScreen } from '@/components/live/live-screen';

export const metadata: Metadata = { title: 'Live · Undertone' };

/** The conversation as it happens: what is said, what the coach notices, and the moment it buzzes. */
export default function LivePage() {
  return <LiveScreen />;
}
