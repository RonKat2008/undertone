import { Suspense } from 'react';
import { Library } from '@/components/conversations/library';

export default function ConversationsPage() {
  return (
    <Suspense fallback={<p className="serif pt-16 text-[32px] text-ink-3">Opening the library…</p>}>
      <Library />
    </Suspense>
  );
}
