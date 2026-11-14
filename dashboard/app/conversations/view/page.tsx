'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { ConversationView } from '@/components/conversations/conversation-view';

/** /conversations/view?session=<id>, the same query-param style as /debrief?session=<id>. */
function FromQuery() {
  const id = useSearchParams().get('session');
  return <ConversationView key={id ?? ''} sessionId={id && id.length <= 200 ? id : null} />;
}

export default function ConversationPage() {
  return (
    <Suspense fallback={<p className="display-m caret pt-16 text-ink-3">Fetching the conversation…</p>}>
      <FromQuery />
    </Suspense>
  );
}
