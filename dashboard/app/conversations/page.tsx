import { Suspense } from 'react';
import { Library } from '@/components/conversations/library';

export default function ConversationsPage() {
  return (
    <Suspense>
      <Library />
    </Suspense>
  );
}
