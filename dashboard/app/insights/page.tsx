import { Suspense } from 'react';
import { InsightsHome } from '@/components/insights/insights-home';
import { ReportSkeleton } from '@/components/insights/shared';

export default function Page() {
  return (
    <Suspense fallback={<div className="qi-page pt-8" data-width="wide"><ReportSkeleton /></div>}>
      <InsightsHome />
    </Suspense>
  );
}
