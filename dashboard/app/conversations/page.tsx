import { Suspense } from 'react';
import { Library } from '@/components/conversations/library';

export default function ConversationsPage() {
  return (
    <Suspense fallback={<p className="display-m caret pt-16 text-ink-3">Opening the library…</p>}>
      <Library />
    </Suspense>
  );
}
