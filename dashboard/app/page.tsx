import { Suspense } from 'react';
import { GraphHome } from '@/components/graph/graph-home';

export default function Page() {
  return (
    <Suspense fallback={<p className="display-m caret pt-16 text-ink-3">Drawing your graph</p>}>
      <GraphHome />
    </Suspense>
  );
}
