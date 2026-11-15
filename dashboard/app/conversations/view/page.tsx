'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ConversationView } from '@/components/conversations/conversation-view';

/** /conversations/view?session=<id>: one conversation, with its debrief, transcript and recording. */
function FromQuery() {
  const id = useSearchParams().get('session');
  return <ConversationView key={id ?? ''} sessionId={id && id.length <= 200 ? id : null} />;
}

export default function ConversationPage() {
  return (
    <Suspense>
      <FromQuery />
    </Suspense>
  );
}
