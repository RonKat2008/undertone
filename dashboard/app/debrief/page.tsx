import { Suspense } from 'react';
import { DebriefRedirect } from '@/components/conversations/debrief-redirect';

/** The old debrief page: it now opens the conversation page (see DebriefRedirect). */
export default function DebriefPage() {
  return (
    <Suspense>
      <DebriefRedirect />
    </Suspense>
  );
}
